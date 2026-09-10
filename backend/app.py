
import os
import uuid
from datetime import datetime
from functools import wraps

import jwt
import oracledb
from dotenv import load_dotenv
from flask import Flask, jsonify, request, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "")
if len(app.config["SECRET_KEY"]) < 32:
    raise RuntimeError("Set FLASK_SECRET_KEY to a random secret of at least 32 characters.")

ORACLE_USER = os.getenv("ORACLE_USER", "NEXSTOCK")
ORACLE_PASSWORD = os.getenv("ORACLE_PASSWORD", "")
ORACLE_DSN = os.getenv("ORACLE_DSN", "localhost:1521/FREEPDB1")


def get_connection():
    if not ORACLE_PASSWORD:
        raise RuntimeError("ORACLE_PASSWORD is missing from backend/.env")
    return oracledb.connect(
        user=ORACLE_USER,
        password=ORACLE_PASSWORD,
        dsn=ORACLE_DSN,
    )


def initialize_super_admin():
    name = os.getenv("SUPER_ADMIN_NAME", "NexStock Super Admin")
    email = os.getenv("SUPER_ADMIN_EMAIL", "admin@nexstock.local").strip().lower()
    password = os.getenv("SUPER_ADMIN_PASSWORD", "")

    if len(password) < 12:
        raise RuntimeError(
            "Set SUPER_ADMIN_PASSWORD in backend/.env to at least 12 characters."
        )

    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT user_id FROM sp_users WHERE LOWER(email) = :email",
            {"email": email},
        )
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                """
                UPDATE sp_users
                SET role = 'SUPER_ADMIN', client_id = NULL, is_active = 1
                WHERE user_id = :user_id
                """,
                {"user_id": existing[0]},
            )
        else:
            cursor.execute(
                """
                INSERT INTO sp_users
                    (client_id, full_name, email, password_hash, role, is_active)
                VALUES
                    (NULL, :full_name, :email, :password_hash, 'SUPER_ADMIN', 1)
                """,
                {
                    "full_name": name,
                    "email": email,
                    "password_hash": generate_password_hash(password),
                },
            )
        connection.commit()
        cursor.close()
    finally:
        connection.close()


def token_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Authentication token required"}), 401

        token = header.split(" ", 1)[1]
        try:
            g.user = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"],
            )
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401

        return function(*args, **kwargs)
    return wrapper


def role_required(*roles):
    def decorator(function):
        @wraps(function)
        @token_required
        def wrapper(*args, **kwargs):
            if g.user.get("role") not in roles:
                return jsonify({"error": "Insufficient permissions"}), 403
            return function(*args, **kwargs)
        return wrapper
    return decorator


@app.get("/")
def index():
    return jsonify({
        "application": "NexStock",
        "message": "Inventory management API is running",
    })


@app.get("/api/health")
def health():
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 'connected' FROM dual")
        status = cursor.fetchone()[0]
        cursor.close()
        return jsonify({
            "status": "ok",
            "database": status,
            "application": "NexStock",
        })
    except Exception:
        app.logger.exception("Health check failed")
        return jsonify({
            "status": "error",
            "message": "Database connection failed. Check backend/.env and Oracle.",
        }), 503
    finally:
        if connection:
            connection.close()


@app.post("/api/register")
def register_business():
    data = request.get_json(silent=True) or {}

    business_name = str(data.get("business_name", "")).strip()
    full_name = str(data.get("full_name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    phone = str(data.get("phone", "")).strip()
    address = str(data.get("address", "")).strip()

    if not business_name or not full_name or not email or not password:
        return jsonify({
            "error": "Business name, full name, email, and password are required"
        }), 400

    if len(password) < 12:
        return jsonify({"error": "Password must contain at least 12 characters"}), 400

    connection = get_connection()
    cursor = connection.cursor()

    try:
        cursor.execute(
            "SELECT user_id FROM sp_users WHERE LOWER(email) = :email",
            {"email": email},
        )
        if cursor.fetchone():
            return jsonify({"error": "Email is already registered"}), 409

        cursor.execute(
            """
            INSERT INTO sp_clients
                (business_name, business_email, business_phone,
                 business_address, status)
            VALUES (:business_name, :email, :phone, :address, 'PENDING')
            RETURNING client_id INTO :client_id
            """,
            {
                "business_name": business_name,
                "email": email,
                "phone": phone or None,
                "address": address or None,
                "client_id": cursor.var(oracledb.NUMBER),
            },
        )
        client_id = int(cursor.getimplicitresults()[0][0]) if False else None

        # Retrieve the new client using its unique business email.
        cursor.execute(
            "SELECT client_id FROM sp_clients WHERE business_email = :email",
            {"email": email},
        )
        client_id = int(cursor.fetchone()[0])

        cursor.execute(
            """
            INSERT INTO sp_users
                (client_id, full_name, email, password_hash, role, is_active)
            VALUES (:client_id, :full_name, :email, :password_hash,
                    'CLIENT_ADMIN', 1)
            """,
            {
                "client_id": client_id,
                "full_name": full_name,
                "email": email,
                "password_hash": generate_password_hash(password),
            },
        )

        connection.commit()
        return jsonify({
            "message": "Registration submitted for administrator approval",
            "business_status": "PENDING",
        }), 201

    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "This business email is already registered"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Business registration failed")
        return jsonify({"error": "Registration failed"}), 500
    finally:
        cursor.close()
        connection.close()


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    connection = get_connection()
    cursor = connection.cursor()

    try:
        cursor.execute(
            """
            SELECT u.user_id, u.client_id, u.full_name, u.email,
                   u.password_hash, u.role, u.is_active,
                   c.status
            FROM sp_users u
            LEFT JOIN sp_clients c ON c.client_id = u.client_id
            WHERE LOWER(u.email) = :email
            """,
            {"email": email},
        )
        row = cursor.fetchone()

        if not row or not check_password_hash(row[4], password) or row[6] != 1:
            return jsonify({"error": "Invalid email or password"}), 401

        user_id, client_id, name, user_email, _, role, _, client_status = row

        if role != "SUPER_ADMIN" and client_status != "APPROVED":
            return jsonify({
                "error": "Your business account is awaiting approval or is not active",
                "business_status": client_status,
            }), 403

        token = jwt.encode(
            {
                "user_id": int(user_id),
                "client_id": int(client_id) if client_id is not None else None,
                "email": user_email,
                "name": name,
                "role": role,
            },
            app.config["SECRET_KEY"],
            algorithm="HS256",
        )

        return jsonify({
            "token": token,
            "user": {
                "id": int(user_id),
                "client_id": int(client_id) if client_id is not None else None,
                "name": name,
                "email": user_email,
                "role": role,
            },
        })
    finally:
        cursor.close()
        connection.close()


@app.get("/api/admin/registrations")
@role_required("SUPER_ADMIN")
def pending_registrations():
    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT client_id, business_name, business_email,
                   business_phone, business_address, status, created_at
            FROM sp_clients
            ORDER BY created_at DESC
            """
        )
        rows = cursor.fetchall()
        return jsonify([
            {
                "client_id": int(row[0]),
                "business_name": row[1],
                "email": row[2],
                "phone": row[3],
                "address": row[4],
                "status": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
            }
            for row in rows
        ])
    finally:
        cursor.close()
        connection.close()


@app.post("/api/admin/registrations/<int:client_id>/decision")
@role_required("SUPER_ADMIN")
def decide_registration(client_id):
    data = request.get_json(silent=True) or {}
    decision = str(data.get("decision", "")).upper()

    if decision not in ("APPROVED", "REJECTED", "SUSPENDED", "REACTIVATED"):
        return jsonify({"error": "Invalid decision"}), 400

    target_status = "APPROVED" if decision == "REACTIVATED" else decision
    connection = get_connection()
    cursor = connection.cursor()

    try:
        cursor.execute(
            """
            UPDATE sp_clients
            SET status = :status, reviewed_at = SYSTIMESTAMP,
                reviewed_by = :reviewed_by
            WHERE client_id = :client_id
            """,
            {
                "status": target_status,
                "reviewed_by": g.user["email"],
                "client_id": client_id,
            },
        )

        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Business not found"}), 404

        cursor.execute(
            """
            INSERT INTO sp_client_reviews
                (client_id, reviewed_by, decision, comments)
            SELECT :client_id, user_id, :decision, :comments
            FROM sp_users
            WHERE user_id = :user_id
            """,
            {
                "client_id": client_id,
                "decision": decision,
                "comments": str(data.get("comments", "")).strip() or None,
                "user_id": g.user["user_id"],
            },
        )

        connection.commit()
        return jsonify({"message": "Business status updated", "status": target_status})
    except Exception:
        connection.rollback()
        app.logger.exception("Business review failed")
        return jsonify({"error": "Unable to update business status"}), 500
    finally:
        cursor.close()
        connection.close()


@app.get("/api/dashboard/stats")
@token_required
def dashboard_stats():
    if g.user.get("role") == "SUPER_ADMIN":
        connection = get_connection()
        cursor = connection.cursor()
        try:
            cursor.execute(
                """
                SELECT
                    COUNT(*),
                    SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)
                FROM sp_clients
                """
            )
            row = cursor.fetchone()
            return jsonify({
                "total_businesses": int(row[0] or 0),
                "pending_businesses": int(row[1] or 0),
                "approved_businesses": int(row[2] or 0),
            })
        finally:
            cursor.close()
            connection.close()

    client_id = g.user.get("client_id")
    if client_id is None:
        return jsonify({"error": "Client account is not linked to a business"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(*),
                   NVL(SUM(quantity), 0),
                   NVL(SUM(CASE WHEN quantity <= reorder_level
                                THEN 1 ELSE 0 END), 0)
            FROM sp_products
            WHERE client_id = :client_id AND is_active = 1
            """,
            {"client_id": client_id},
        )
        row = cursor.fetchone()
        return jsonify({
            "total_products": int(row[0] or 0),
            "total_units": float(row[1] or 0),
            "low_stock_products": int(row[2] or 0),
        })
    finally:
        cursor.close()
        connection.close()


@app.get("/api/products")
@token_required
def list_products():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT p.product_id, p.sku, p.product_name, p.description,
                   p.category_id, c.category_name,
                   p.supplier_id, s.supplier_name,
                   p.unit_price, p.quantity, p.reorder_level, p.unit
            FROM sp_products p
            LEFT JOIN sp_categories c
              ON c.category_id = p.category_id
             AND c.client_id = p.client_id
            LEFT JOIN sp_suppliers s
              ON s.supplier_id = p.supplier_id
             AND s.client_id = p.client_id
            WHERE p.client_id = :client_id
              AND p.is_active = 1
            ORDER BY p.product_name
            """,
            {"client_id": client_id},
        )
        return jsonify([
            {
                "product_id": int(row[0]),
                "sku": row[1],
                "product_name": row[2],
                "description": row[3],
                "category_id": int(row[4]) if row[4] is not None else None,
                "category_name": row[5],
                "supplier_id": int(row[6]) if row[6] is not None else None,
                "supplier_name": row[7],
                "unit_price": float(row[8]),
                "quantity": float(row[9]),
                "reorder_level": float(row[10]),
                "unit": row[11],
            }
            for row in cursor.fetchall()
        ])
    finally:
        cursor.close()
        connection.close()


@app.post("/api/products")
@token_required
def create_product():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    sku = str(data.get("sku", "")).strip()
    name = str(data.get("product_name", "")).strip()

    if not sku or not name:
        return jsonify({"error": "SKU and product name are required"}), 400

    try:
        price = float(data.get("unit_price", 0))
        quantity = float(data.get("quantity", 0))
        reorder = float(data.get("reorder_level", 5))
        category_id = int(data.get("category_id"))
        supplier_id = int(data.get("supplier_id"))
        if min(price, quantity, reorder) < 0:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({
            "error": "Select a category and supplier, and enter valid non-negative numbers"
        }), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM sp_categories
            WHERE client_id = :client_id AND category_id = :category_id
            """,
            {"client_id": client_id, "category_id": category_id},
        )
        if cursor.fetchone()[0] == 0:
            return jsonify({"error": "Selected category was not found"}), 400

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM sp_suppliers
            WHERE client_id = :client_id AND supplier_id = :supplier_id
            """,
            {"client_id": client_id, "supplier_id": supplier_id},
        )
        if cursor.fetchone()[0] == 0:
            return jsonify({"error": "Selected supplier was not found"}), 400

        cursor.execute(
            """
            INSERT INTO sp_products
                (client_id, category_id, supplier_id, sku, product_name,
                 description, unit_price, quantity, reorder_level, unit)
            VALUES
                (:client_id, :category_id, :supplier_id, :sku, :product_name,
                 :description, :unit_price, :quantity, :reorder_level, :unit)
            """,
            {
                "client_id": client_id,
                "category_id": category_id,
                "supplier_id": supplier_id,
                "sku": sku,
                "product_name": name,
                "description": str(data.get("description", "")).strip() or None,
                "unit_price": price,
                "quantity": quantity,
                "reorder_level": reorder,
                "unit": str(data.get("unit", "pcs")).strip() or "pcs",
            },
        )
        # Record the opening balance in the stock ledger when a product is created.
        if quantity > 0:
            cursor.execute(
                """
                INSERT INTO sp_stock_transactions
                    (client_id, product_id, transaction_type, quantity_change,
                     quantity_before, quantity_after, notes, performed_by, created_by)
                SELECT :client_id, product_id, 'IN', :quantity,
                       0, :quantity, 'Opening stock', :created_by, :created_by
                FROM sp_products
                WHERE client_id = :client_id AND sku = :sku
                """,
                {
                    "client_id": client_id,
                    "quantity": quantity,
                    "created_by": g.user["user_id"],
                    "sku": sku,
                },
            )
        connection.commit()
        return jsonify({"message": "Product created successfully"}), 201
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({
            "error": "SKU already exists or selected category/supplier is invalid"
        }), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Product creation failed")
        return jsonify({"error": "Unable to create product"}), 500
    finally:
        cursor.close()
        connection.close()


@app.put("/api/products/<int:product_id>")
@token_required
def update_product(product_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    sku = str(data.get("sku", "")).strip()
    name = str(data.get("product_name", "")).strip()
    if not sku or not name:
        return jsonify({"error": "SKU and product name are required"}), 400

    try:
        price = float(data.get("unit_price", 0))
        reorder = float(data.get("reorder_level", 5))
        category_id = int(data.get("category_id"))
        supplier_id = int(data.get("supplier_id"))
        if min(price, reorder) < 0:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Select a category and supplier, and enter valid non-negative numbers"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        for table, key, value, label in (
            ("sp_categories", "category_id", category_id, "category"),
            ("sp_suppliers", "supplier_id", supplier_id, "supplier"),
        ):
            cursor.execute(
                f"SELECT COUNT(*) FROM {table} WHERE client_id = :client_id AND {key} = :value",
                {"client_id": client_id, "value": value},
            )
            if cursor.fetchone()[0] == 0:
                return jsonify({"error": f"Selected {label} was not found"}), 400

        cursor.execute(
            """
            UPDATE sp_products
               SET category_id = :category_id,
                   supplier_id = :supplier_id,
                   sku = :sku,
                   product_name = :product_name,
                   description = :description,
                   unit_price = :unit_price,
                   reorder_level = :reorder_level,
                   unit = :unit
             WHERE product_id = :product_id
               AND client_id = :client_id
               AND is_active = 1
            """,
            {
                "category_id": category_id,
                "supplier_id": supplier_id,
                "sku": sku,
                "product_name": name,
                "description": str(data.get("description", "")).strip() or None,
                "unit_price": price,
                "reorder_level": reorder,
                "unit": str(data.get("unit", "pcs")).strip() or "pcs",
                "product_id": product_id,
                "client_id": client_id,
            },
        )
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Product not found"}), 404
        connection.commit()
        return jsonify({"message": "Product updated successfully"})
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "SKU already exists or selected category/supplier is invalid"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Product update failed")
        return jsonify({"error": "Unable to update product"}), 500
    finally:
        cursor.close()
        connection.close()


@app.delete("/api/products/<int:product_id>")
@token_required
def delete_product(product_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            UPDATE sp_products
               SET is_active = 0
             WHERE product_id = :product_id
               AND client_id = :client_id
               AND is_active = 1
            """,
            {"product_id": product_id, "client_id": client_id},
        )
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Product not found"}), 404
        connection.commit()
        return jsonify({"message": "Product deleted successfully"})
    except Exception:
        connection.rollback()
        app.logger.exception("Product deletion failed")
        return jsonify({"error": "Unable to delete product"}), 500
    finally:
        cursor.close()
        connection.close()


@app.get("/api/stock-transactions")
@token_required
def list_stock_transactions():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT t.transaction_id, t.product_id, p.product_name, p.sku,
                   t.transaction_type, t.quantity_change, t.quantity_before,
                   t.quantity_after, t.notes, t.created_at, u.full_name
              FROM sp_stock_transactions t
              JOIN sp_products p ON p.product_id = t.product_id
              LEFT JOIN sp_users u ON u.user_id = COALESCE(t.created_by, t.performed_by)
             WHERE t.client_id = :client_id
             ORDER BY t.created_at DESC, t.transaction_id DESC
            """,
            {"client_id": client_id},
        )
        return jsonify([
            {
                "transaction_id": int(row[0]),
                "product_id": int(row[1]),
                "product_name": row[2],
                "sku": row[3],
                "transaction_type": row[4],
                "quantity": float(row[5]),
                "previous_quantity": float(row[6]),
                "new_quantity": float(row[7]),
                "reason": row[8],
                "created_at": row[9].isoformat() if row[9] else None,
                "created_by": row[10] or "Unknown",
            }
            for row in cursor.fetchall()
        ])
    finally:
        cursor.close()
        connection.close()


@app.post("/api/products/<int:product_id>/stock-transactions")
@token_required
def create_stock_transaction(product_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    transaction_type = str(data.get("transaction_type", "")).strip().upper()
    reason = str(data.get("reason", "")).strip()
    try:
        quantity = float(data.get("quantity", 0))
        if quantity <= 0 or transaction_type not in ("IN", "OUT"):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Choose Stock In or Stock Out and enter a quantity greater than zero"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            SELECT quantity
              FROM sp_products
             WHERE product_id = :product_id
               AND client_id = :client_id
               AND is_active = 1
             FOR UPDATE
            """,
            {"product_id": product_id, "client_id": client_id},
        )
        row = cursor.fetchone()
        if not row:
            connection.rollback()
            return jsonify({"error": "Product not found"}), 404

        previous_quantity = float(row[0] or 0)
        if transaction_type == "OUT" and quantity > previous_quantity:
            connection.rollback()
            return jsonify({"error": f"Insufficient stock. Only {previous_quantity:g} units are available."}), 400

        new_quantity = previous_quantity + quantity if transaction_type == "IN" else previous_quantity - quantity
        cursor.execute(
            "UPDATE sp_products SET quantity = :quantity WHERE product_id = :product_id AND client_id = :client_id",
            {"quantity": new_quantity, "product_id": product_id, "client_id": client_id},
        )
        cursor.execute(
            """
            INSERT INTO sp_stock_transactions
                (client_id, product_id, transaction_type, quantity_change,
                 quantity_before, quantity_after, notes, performed_by, created_by)
            VALUES
                (:client_id, :product_id, :transaction_type, :quantity,
                 :previous_quantity, :new_quantity, :reason, :created_by, :created_by)
            """,
            {
                "client_id": client_id,
                "product_id": product_id,
                "transaction_type": transaction_type,
                "quantity": quantity,
                "previous_quantity": previous_quantity,
                "new_quantity": new_quantity,
                "reason": reason or None,
                "created_by": g.user["user_id"],
            },
        )
        connection.commit()
        return jsonify({
            "message": "Stock moved successfully",
            "previous_quantity": previous_quantity,
            "new_quantity": new_quantity,
        }), 201
    except Exception:
        connection.rollback()
        app.logger.exception("Stock transaction failed")
        return jsonify({"error": "Unable to record stock movement"}), 500
    finally:
        cursor.close()
        connection.close()


# =========================
# CATEGORIES API
# =========================

@app.get("/api/categories")
@token_required
def list_categories():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT category_id, category_name, description
            FROM sp_categories
            WHERE client_id = :client_id
            ORDER BY category_name
        """, {"client_id": client_id})
        return jsonify([
            {
                "category_id": int(row[0]),
                "category_name": row[1],
                "description": row[2],
            }
            for row in cursor.fetchall()
        ]), 200
    finally:
        cursor.close()
        connection.close()


@app.post("/api/categories")
@token_required
def create_category():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get("category_name", "")).strip()
    description = str(data.get("description", "")).strip()
    if not name:
        return jsonify({"error": "Category name is required"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM sp_categories
            WHERE client_id = :client_id
              AND LOWER(category_name) = LOWER(:category_name)
        """, {"client_id": client_id, "category_name": name})
        if cursor.fetchone()[0] > 0:
            return jsonify({"error": "This category already exists"}), 409

        cursor.execute("""
            INSERT INTO sp_categories (client_id, category_name, description)
            VALUES (:client_id, :category_name, :description)
        """, {
            "client_id": client_id,
            "category_name": name,
            "description": description or None,
        })
        connection.commit()
        return jsonify({"message": "Category created successfully"}), 201
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "Category already exists or the supplied data is invalid"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Category creation failed")
        return jsonify({"error": "Unable to create category"}), 500
    finally:
        cursor.close()
        connection.close()


@app.put("/api/categories/<int:category_id>")
@token_required
def update_category(category_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get("category_name", "")).strip()
    description = str(data.get("description", "")).strip()
    if not name:
        return jsonify({"error": "Category name is required"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM sp_categories
            WHERE client_id = :client_id
              AND LOWER(category_name) = LOWER(:category_name)
              AND category_id <> :category_id
        """, {
            "client_id": client_id,
            "category_name": name,
            "category_id": category_id,
        })
        if cursor.fetchone()[0] > 0:
            return jsonify({"error": "Another category already uses this name"}), 409

        cursor.execute("""
            UPDATE sp_categories
            SET category_name = :category_name, description = :description
            WHERE category_id = :category_id AND client_id = :client_id
        """, {
            "category_name": name,
            "description": description or None,
            "category_id": category_id,
            "client_id": client_id,
        })
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Category not found"}), 404
        connection.commit()
        return jsonify({"message": "Category updated successfully"}), 200
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "Category name conflicts with an existing category"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Category update failed")
        return jsonify({"error": "Unable to update category"}), 500
    finally:
        cursor.close()
        connection.close()


@app.delete("/api/categories/<int:category_id>")
@token_required
def delete_category(category_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM sp_products
            WHERE client_id = :client_id AND category_id = :category_id
        """, {"client_id": client_id, "category_id": category_id})
        if cursor.fetchone()[0] > 0:
            return jsonify({
                "error": "This category is assigned to products and cannot be deleted"
            }), 409

        cursor.execute("""
            DELETE FROM sp_categories
            WHERE category_id = :category_id AND client_id = :client_id
        """, {"category_id": category_id, "client_id": client_id})
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Category not found"}), 404
        connection.commit()
        return jsonify({"message": "Category deleted successfully"}), 200
    except Exception:
        connection.rollback()
        app.logger.exception("Category deletion failed")
        return jsonify({"error": "Unable to delete category"}), 500
    finally:
        cursor.close()
        connection.close()


# =========================
# SUPPLIERS API
# =========================

@app.get("/api/suppliers")
@token_required
def list_suppliers():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT supplier_id, supplier_name, contact_name, email, phone, address
            FROM sp_suppliers
            WHERE client_id = :client_id
            ORDER BY supplier_name
        """, {"client_id": client_id})
        return jsonify([
            {
                "supplier_id": int(row[0]),
                "supplier_name": row[1],
                "contact_name": row[2],
                "email": row[3],
                "phone": row[4],
                "address": row[5],
            }
            for row in cursor.fetchall()
        ]), 200
    finally:
        cursor.close()
        connection.close()


@app.post("/api/suppliers")
@token_required
def create_supplier():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get("supplier_name", "")).strip()
    if not name:
        return jsonify({"error": "Supplier name is required"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            INSERT INTO sp_suppliers
                (client_id, supplier_name, contact_name, email, phone, address)
            VALUES
                (:client_id, :supplier_name, :contact_name, :email, :phone, :address)
        """, {
            "client_id": client_id,
            "supplier_name": name,
            "contact_name": str(data.get("contact_name", "")).strip() or None,
            "email": str(data.get("email", "")).strip() or None,
            "phone": str(data.get("phone", "")).strip() or None,
            "address": str(data.get("address", "")).strip() or None,
        })
        connection.commit()
        return jsonify({"message": "Supplier created successfully"}), 201
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "Supplier data conflicts with an existing record or is invalid"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Supplier creation failed")
        return jsonify({"error": "Unable to create supplier"}), 500
    finally:
        cursor.close()
        connection.close()


@app.put("/api/suppliers/<int:supplier_id>")
@token_required
def update_supplier(supplier_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get("supplier_name", "")).strip()
    if not name:
        return jsonify({"error": "Supplier name is required"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            UPDATE sp_suppliers
            SET supplier_name = :supplier_name,
                contact_name = :contact_name,
                email = :email,
                phone = :phone,
                address = :address
            WHERE supplier_id = :supplier_id AND client_id = :client_id
        """, {
            "supplier_name": name,
            "contact_name": str(data.get("contact_name", "")).strip() or None,
            "email": str(data.get("email", "")).strip() or None,
            "phone": str(data.get("phone", "")).strip() or None,
            "address": str(data.get("address", "")).strip() or None,
            "supplier_id": supplier_id,
            "client_id": client_id,
        })
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Supplier not found"}), 404
        connection.commit()
        return jsonify({"message": "Supplier updated successfully"}), 200
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "Supplier data conflicts with an existing record or is invalid"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Supplier update failed")
        return jsonify({"error": "Unable to update supplier"}), 500
    finally:
        cursor.close()
        connection.close()


@app.delete("/api/suppliers/<int:supplier_id>")
@token_required
def delete_supplier(supplier_id):
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            DELETE FROM sp_suppliers
            WHERE supplier_id = :supplier_id AND client_id = :client_id
        """, {"supplier_id": supplier_id, "client_id": client_id})
        if cursor.rowcount == 0:
            connection.rollback()
            return jsonify({"error": "Supplier not found"}), 404
        connection.commit()
        return jsonify({"message": "Supplier deleted successfully"}), 200
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({
            "error": "This supplier is linked to existing records and cannot be deleted"
        }), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Supplier deletion failed")
        return jsonify({"error": "Unable to delete supplier"}), 500
    finally:
        cursor.close()
        connection.close()


# =========================
# PURCHASE ORDERS API
# =========================

def _client_user():
    client_id = g.user.get("client_id")
    if g.user.get("role") == "SUPER_ADMIN" or client_id is None:
        return None
    return int(client_id)


@app.get("/api/purchase-orders")
@token_required
def list_purchase_orders():
    client_id = _client_user()
    if client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT
                po.purchase_order_id,
                po.order_number,
                po.status,
                po.expected_date,
                po.notes,
                po.created_at,
                s.supplier_name,
                NVL(SUM(i.quantity_ordered * i.unit_cost), 0) AS total_value,
                COUNT(i.item_id) AS item_count
            FROM sp_purchase_orders po
            JOIN sp_suppliers s
              ON s.supplier_id = po.supplier_id
             AND s.client_id = po.client_id
            LEFT JOIN sp_purchase_order_items i
              ON i.purchase_order_id = po.purchase_order_id
             AND i.client_id = po.client_id
            WHERE po.client_id = :client_id
            GROUP BY po.purchase_order_id, po.order_number, po.status,
                     po.expected_date, po.notes, po.created_at, s.supplier_name
            ORDER BY po.created_at DESC, po.purchase_order_id DESC
        """, {"client_id": client_id})
        orders = []
        order_map = {}
        for row in cursor.fetchall():
            expected = row[3]
            created = row[5]
            order = {
                "purchase_order_id": int(row[0]),
                "order_number": row[1],
                "status": row[2],
                "expected_date": expected.isoformat() if expected else None,
                "notes": row[4],
                "created_at": created.isoformat() if created else None,
                "supplier_name": row[6],
                "total_value": float(row[7] or 0),
                "item_count": int(row[8] or 0),
            }
            order["items"] = []
            orders.append(order)
            order_map[order["purchase_order_id"]] = order

        cursor.execute("""
            SELECT
                i.purchase_order_id,
                i.item_id,
                i.product_id,
                p.product_name,
                p.sku,
                i.quantity_ordered,
                i.quantity_received,
                i.unit_cost
            FROM sp_purchase_order_items i
            JOIN sp_products p ON p.product_id = i.product_id
            WHERE i.client_id = :client_id
            ORDER BY i.purchase_order_id DESC, i.item_id
        """, {"client_id": client_id})
        for row in cursor.fetchall():
            order = order_map.get(int(row[0]))
            if order is None:
                continue
            ordered = float(row[5] or 0)
            received = float(row[6] or 0)
            order["items"].append({
                "purchase_order_item_id": int(row[1]),
                "product_id": int(row[2]),
                "product_name": row[3],
                "sku": row[4],
                "quantity_ordered": ordered,
                "quantity_received": received,
                "outstanding_quantity": max(0, ordered - received),
                "unit_cost": float(row[7] or 0),
            })
        return jsonify(orders), 200
    except Exception:
        app.logger.exception("Purchase order listing failed")
        return jsonify({"error": "Unable to load purchase orders"}), 500
    finally:
        cursor.close()
        connection.close()


@app.post("/api/purchase-orders")
@token_required
def create_purchase_order():
    client_id = _client_user()
    if client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    try:
        supplier_id = int(data.get("supplier_id"))
        if supplier_id <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Select a valid supplier"}), 400

    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify({"error": "Add at least one product to the purchase order"}), 400
    if len(raw_items) > 100:
        return jsonify({"error": "A purchase order can contain at most 100 item lines"}), 400

    items = []
    seen_product_ids = set()
    try:
        for raw in raw_items:
            product_id = int(raw.get("product_id"))
            quantity = float(raw.get("quantity"))
            unit_cost = float(raw.get("unit_cost", 0))
            if product_id <= 0 or quantity <= 0 or unit_cost < 0:
                raise ValueError()
            if product_id in seen_product_ids:
                return jsonify({"error": "Each product may appear only once in an order"}), 400
            seen_product_ids.add(product_id)
            items.append({
                "product_id": product_id,
                "quantity": quantity,
                "unit_cost": unit_cost,
            })
    except (AttributeError, TypeError, ValueError, OverflowError):
        return jsonify({"error": "Each order line needs a valid product, positive quantity and non-negative unit cost"}), 400

    expected_date = None
    raw_date = str(data.get("expected_date") or "").strip()
    if raw_date:
        try:
            expected_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Expected delivery date must use YYYY-MM-DD"}), 400

    notes = str(data.get("notes") or "").strip()
    if len(notes) > 1000:
        return jsonify({"error": "Notes must not exceed 1000 characters"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM sp_suppliers
            WHERE supplier_id = :supplier_id AND client_id = :client_id
        """, {"supplier_id": supplier_id, "client_id": client_id})
        if cursor.fetchone()[0] == 0:
            connection.rollback()
            return jsonify({"error": "Selected supplier was not found"}), 400

        for item in items:
            cursor.execute("""
                SELECT COUNT(*) FROM sp_products
                WHERE product_id = :product_id
                  AND client_id = :client_id
                  AND is_active = 1
            """, {"product_id": item["product_id"], "client_id": client_id})
            if cursor.fetchone()[0] == 0:
                connection.rollback()
                return jsonify({"error": "One of the selected products was not found or is inactive"}), 400

        order_number = f"PO-{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"
        new_order_id = cursor.var(oracledb.NUMBER)
        cursor.execute("""
            INSERT INTO sp_purchase_orders
                (client_id, supplier_id, order_number, status, expected_date,
                 notes, created_by, created_at)
            VALUES
                (:client_id, :supplier_id, :order_number, 'ORDERED', :expected_date,
                 :notes, :created_by, SYSTIMESTAMP)
            RETURNING purchase_order_id INTO :new_order_id
        """, {
            "client_id": client_id,
            "supplier_id": supplier_id,
            "order_number": order_number,
            "expected_date": expected_date,
            "notes": notes or None,
            "created_by": int(g.user["user_id"]),
            "new_order_id": new_order_id,
        })
        order_id = int(new_order_id.getvalue()[0])

        for item in items:
            cursor.execute("""
                INSERT INTO sp_purchase_order_items
                    (purchase_order_id, client_id, product_id, quantity_ordered,
                     quantity_received, unit_cost)
                VALUES
                    (:order_id, :client_id, :product_id, :quantity, 0,
                     :unit_cost)
            """, {
                "order_id": order_id,
                "client_id": client_id,
                "product_id": item["product_id"],
                "quantity": item["quantity"],
                "unit_cost": item["unit_cost"],
            })

        connection.commit()
        return jsonify({
            "message": "Purchase order created successfully",
            "purchase_order_id": order_id,
            "order_number": order_number,
        }), 201
    except oracledb.IntegrityError:
        connection.rollback()
        return jsonify({"error": "The purchase order contains invalid or conflicting records"}), 409
    except Exception:
        connection.rollback()
        app.logger.exception("Purchase order creation failed")
        return jsonify({"error": "Unable to create purchase order"}), 500
    finally:
        cursor.close()
        connection.close()


@app.put("/api/purchase-orders/<int:purchase_order_id>/status")
@token_required
def update_purchase_order_status(purchase_order_id):
    client_id = _client_user()
    if client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip().upper()
    if status != "CANCELLED":
        return jsonify({"error": "Only cancellation is supported through this action"}), 400

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT status
            FROM sp_purchase_orders
            WHERE purchase_order_id = :order_id AND client_id = :client_id
            FOR UPDATE
        """, {"order_id": purchase_order_id, "client_id": client_id})
        row = cursor.fetchone()
        if not row:
            connection.rollback()
            return jsonify({"error": "Purchase order not found"}), 404
        if row[0] != "ORDERED":
            connection.rollback()
            return jsonify({"error": "Only an order that has not been received can be cancelled"}), 409

        cursor.execute("""
            UPDATE sp_purchase_orders
               SET status = 'CANCELLED'
             WHERE purchase_order_id = :order_id AND client_id = :client_id
        """, {"order_id": purchase_order_id, "client_id": client_id})
        connection.commit()
        return jsonify({"message": "Purchase order cancelled"}), 200
    except Exception:
        connection.rollback()
        app.logger.exception("Purchase order status update failed")
        return jsonify({"error": "Unable to update purchase order status"}), 500
    finally:
        cursor.close()
        connection.close()


@app.post("/api/purchase-orders/<int:purchase_order_id>/receive")
@token_required
def receive_purchase_order(purchase_order_id):
    client_id = _client_user()
    if client_id is None:
        return jsonify({"error": "A client account is required"}), 403

    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("""
            SELECT order_number, status
            FROM sp_purchase_orders
            WHERE purchase_order_id = :order_id AND client_id = :client_id
            FOR UPDATE
        """, {"order_id": purchase_order_id, "client_id": client_id})
        order = cursor.fetchone()
        if not order:
            connection.rollback()
            return jsonify({"error": "Purchase order not found"}), 404
        order_number, status = order
        if status == "CANCELLED":
            connection.rollback()
            return jsonify({"error": "A cancelled purchase order cannot be received"}), 409
        if status == "RECEIVED":
            connection.rollback()
            return jsonify({"error": "This purchase order has already been received"}), 409

        cursor.execute("""
            SELECT item_id, product_id, quantity_ordered,
                   quantity_received
            FROM sp_purchase_order_items
            WHERE purchase_order_id = :order_id AND client_id = :client_id
            FOR UPDATE
        """, {"order_id": purchase_order_id, "client_id": client_id})
        items = cursor.fetchall()
        if not items:
            connection.rollback()
            return jsonify({"error": "This purchase order has no items"}), 409

        received_any = False
        for item_id, product_id, quantity_ordered, quantity_received in items:
            remaining = float(quantity_ordered or 0) - float(quantity_received or 0)
            if remaining <= 0:
                continue

            cursor.execute("""
                SELECT quantity
                FROM sp_products
                WHERE product_id = :product_id
                  AND client_id = :client_id
                  AND is_active = 1
                FOR UPDATE
            """, {"product_id": int(product_id), "client_id": client_id})
            product_row = cursor.fetchone()
            if not product_row:
                connection.rollback()
                return jsonify({"error": "An order product is no longer active; reactivate or replace it before receiving"}), 409

            before = float(product_row[0] or 0)
            after = before + remaining
            cursor.execute("""
                UPDATE sp_products
                   SET quantity = :quantity
                 WHERE product_id = :product_id AND client_id = :client_id
            """, {"quantity": after, "product_id": int(product_id), "client_id": client_id})
            cursor.execute("""
                INSERT INTO sp_stock_transactions
                    (client_id, product_id, transaction_type, quantity_change,
                     quantity_before, quantity_after, notes, performed_by, created_by)
                VALUES
                    (:client_id, :product_id, 'IN', :quantity,
                     :before_qty, :after_qty, :notes, :user_id, :user_id)
            """, {
                "client_id": client_id,
                "product_id": int(product_id),
                "quantity": remaining,
                "before_qty": before,
                "after_qty": after,
                "notes": f"Received against purchase order {order_number}",
                "user_id": int(g.user["user_id"]),
            })
            cursor.execute("""
                UPDATE sp_purchase_order_items
                   SET quantity_received = quantity_ordered
                 WHERE item_id = :item_id
                   AND purchase_order_id = :order_id
                   AND client_id = :client_id
            """, {
                "item_id": int(item_id),
                "order_id": purchase_order_id,
                "client_id": client_id,
            })
            received_any = True

        if not received_any:
            connection.rollback()
            return jsonify({"error": "No remaining quantities to receive"}), 409

        cursor.execute("""
            UPDATE sp_purchase_orders
               SET status = 'RECEIVED'
             WHERE purchase_order_id = :order_id AND client_id = :client_id
        """, {"order_id": purchase_order_id, "client_id": client_id})
        connection.commit()
        return jsonify({"message": f"Purchase order {order_number} received and stock updated"}), 200
    except Exception:
        connection.rollback()
        app.logger.exception("Purchase order receiving failed")
        return jsonify({"error": "Unable to receive purchase order"}), 500
    finally:
        cursor.close()
        connection.close()



if __name__ == "__main__":
    initialize_super_admin()
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("APP_PORT", "5000")),
        debug=True,
    )
