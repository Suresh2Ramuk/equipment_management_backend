CREATE DATABASE IF NOT EXISTS `react_demo_sql`;

USE `react_demo_sql`;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    department VARCHAR(50) NOT NULL,
    designation VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO employees
(employee_id, name, email, phone, department, designation, city)
VALUES
('EMP001', 'Arun Kumar', 'arun.kumar@example.com', '9876543210', 'CSE', 'Software Developer', 'Chennai'),
('EMP002', 'Priya Sharma', 'priya.sharma@example.com', '9876543211', 'HR', 'HR Executive', 'Bangalore'),
('EMP003', 'Karthik S', 'karthik.s@example.com', '9876543212', 'IT', 'Backend Developer', 'Chennai'),
('EMP004', 'Divya R', 'divya.r@example.com', '9876543213', 'Finance', 'Accountant', 'Coimbatore'),
('EMP005', 'Rahul Kumar', 'rahul.kumar@example.com', '9876543214', 'Marketing', 'Marketing Executive', 'Madurai'),
('EMP006', 'Nithya P', 'nithya.p@example.com', '9876543215', 'IT', 'Frontend Developer', 'Chennai'),
('EMP007', 'Vijay Anand', 'vijay.anand@example.com', '9876543216', 'CSE', 'Software Developer', 'Pune'),
('EMP008', 'Meena S', 'meena.s@example.com', '9876543217', 'HR', 'HR Executive', 'Chennai'),
('EMP009', 'Sanjay M', 'sanjay.m@example.com', '9876543218', 'Finance', 'Accountant', 'Bangalore'),
('EMP010', 'Anjali K', 'anjali.k@example.com', '9876543219', 'IT', 'Backend Developer', 'Hyderabad');



USE react_demo_sql;

CREATE TABLE IF NOT EXISTS password_reset_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_reset_user (
        user_id,
        used_at,
        created_at
    ),

    CONSTRAINT fk_reset_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

USE react_demo_sql;

CREATE TABLE IF NOT EXISTS device (
    dev_id VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (dev_id)
);

CREATE TABLE IF NOT EXISTS equipment (
    equ_id VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    dev_id VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (equ_id),

    CONSTRAINT fk_equipment_device
        FOREIGN KEY (dev_id)
        REFERENCES device(dev_id)
);

CREATE TABLE IF NOT EXISTS equipment_log_data (
    log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    equ_id VARCHAR(30) NOT NULL,
    dev_id VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (log_id),

    CONSTRAINT fk_log_equipment
        FOREIGN KEY (equ_id)
        REFERENCES equipment(equ_id),

    CONSTRAINT fk_log_device
        FOREIGN KEY (dev_id)
        REFERENCES device(dev_id),

    INDEX idx_log_equipment_created (equ_id, created_at),
    INDEX idx_log_device_created (dev_id, created_at)
);

USE react_demo_sql;

DROP TRIGGER IF EXISTS after_equipment_insert;

DELIMITER $$

CREATE TRIGGER after_equipment_insert
AFTER INSERT ON equipment
FOR EACH ROW
BEGIN
    INSERT INTO equipment_log_data (
        equ_id,
        dev_id,
        created_at
    )
    VALUES (
        NEW.equ_id,
        NEW.dev_id,
        NEW.created_at
    );
END$$

DELIMITER ;


USE react_demo_sql;

ALTER TABLE equipment_log_data
    ADD COLUMN pmtwofive DECIMAL(6,2) NULL,
    ADD COLUMN tvoc DECIMAL(6,2) NULL,
    ADD COLUMN temp DECIMAL(6,2) NULL,
    ADD COLUMN hum DECIMAL(5,2) NULL,
    ADD COLUMN cotwo DECIMAL(6,2) NULL,
    ADD COLUMN pmten DECIMAL(6,2) NULL;

-- Equipment Manager RBAC migration
-- BACK UP react_demo_sql BEFORE RUNNING.
-- Run this migration ONCE. The ALTER TABLE statements are not repeatable.

USE react_demo_sql;

CREATE TABLE IF NOT EXISTS roles (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    permission_key VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO roles (name, description) VALUES
    ('admin', 'Full access, including user and role administration'),
    ('manager', 'Operational access to devices, equipment, logs and analytics'),
    ('viewer', 'Read-only access to operational pages')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO permissions (permission_key, description) VALUES
    ('dashboard.view', 'View the dashboard summary'),
    ('devices.view', 'View devices'),
    ('devices.create', 'Create devices'),
    ('devices.update', 'Update devices'),
    ('devices.delete', 'Delete devices'),
    ('equipment.view', 'View equipment'),
    ('equipment.create', 'Create equipment'),
    ('equipment.update', 'Update equipment'),
    ('equipment.delete', 'Delete equipment'),
    ('logs.view', 'View equipment sensor logs'),
    ('logs.create', 'Submit sensor readings'),
    ('analytics.view', 'View sensor analytics and charts'),
    ('users.view', 'View and monitor registered users'),
    ('users.manage_roles', 'Assign user roles and edit role permissions'),
    ('users.manage_status', 'Enable and disable user accounts')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Admin receives every current permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin';

-- Manager can operate the equipment application, but cannot administer users.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
    'dashboard.view',
    'devices.view', 'devices.create',
    'equipment.view', 'equipment.create',
    'logs.view', 'logs.create',
    'analytics.view'
)
WHERE r.name = 'manager';

-- Viewer has read-only page access.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
    'dashboard.view', 'devices.view', 'equipment.view', 'logs.view', 'analytics.view'
)
WHERE r.name = 'viewer';

-- Add the new fields to the existing users table. Run these ALTER statements once.
ALTER TABLE users
    ADD COLUMN role_id INT NULL AFTER password_hash,
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role_id,
    ADD COLUMN last_login_at DATETIME NULL AFTER created_at,
    ADD INDEX idx_users_role_id (role_id),
    ADD INDEX idx_users_active (is_active);

-- Existing accounts become viewers unless explicitly bootstrapped below.
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'viewer' LIMIT 1)
WHERE role_id IS NULL;

-- Bootstrap the known administrator shown in the supplied users screenshot.
-- Change the email if the intended initial administrator uses another account.
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'admin' LIMIT 1)
WHERE LOWER(email) = LOWER('admin@gmail.com');

ALTER TABLE users
    MODIFY COLUMN role_id INT NOT NULL,
    ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id);

CREATE TABLE IF NOT EXISTS user_admin_audit (
    audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NOT NULL,
    target_user_id INT NULL,
    action VARCHAR(60) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_admin_audit_created (created_at),
    INDEX idx_user_admin_audit_target (target_user_id, created_at)
) ENGINE=InnoDB;

-- Verify bootstrap and assigned roles.
SELECT u.id, u.name, u.email, r.name AS role, u.is_active, u.created_at
FROM users u JOIN roles r ON r.id = u.role_id
ORDER BY u.id;

UPDATE users
SET role_id = (
    SELECT id
    FROM roles
    WHERE name = 'admin'
    LIMIT 1
)
WHERE id = 2;

SELECT
    u.id,
    u.name,
    u.email,
    r.name AS role,
    u.is_active,
    u.last_login_at
FROM users u
JOIN roles r
    ON u.role_id = r.id
ORDER BY u.id;

SELECT
    r.name AS role_name,
    p.permission_key,
    p.description
FROM role_permissions rp
JOIN roles r
    ON rp.role_id = r.id
JOIN permissions p
    ON rp.permission_id = p.id
ORDER BY r.name, p.permission_key;


USE react_demo_sql;

CREATE TABLE IF NOT EXISTS user_admin_audit (
    audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id INT NOT NULL,
    target_user_id INT NULL,
    action VARCHAR(60) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (audit_id),
    INDEX idx_user_admin_audit_created (created_at),
    INDEX idx_user_admin_audit_target (target_user_id, created_at)
) ENGINE=InnoDB;

SHOW TABLES LIKE 'user_admin_audit';

DESCRIBE user_admin_audit;

SELECT *
FROM user_admin_audit
ORDER BY audit_id DESC
LIMIT 20;

USE react_demo_sql;

SELECT id, name, description FROM roles ORDER BY id;

SELECT
    u.id,
    u.name,
    u.email,
    u.role_id,
    r.name AS role_name,
    u.is_active,
    u.created_at,
    u.last_login_at
FROM users AS u
LEFT JOIN roles AS r ON r.id = u.role_id
ORDER BY u.id;

SELECT COUNT(*) AS users_without_role
FROM users
WHERE role_id IS NULL;

UPDATE users AS u
JOIN roles AS r ON r.name = 'viewer'
SET u.role_id = r.id
WHERE u.role_id IS NULL AND u.id > 0;


SHOW TABLES LIKE 'user_admin_audit';
SHOW COLUMNS FROM users LIKE 'last_login_at';