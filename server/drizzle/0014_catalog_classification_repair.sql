-- Reviewed legacy inventory, 2026-10-16: match exact SKU and product name.
-- Manufacturer is recorded only where the product identifies ASUS, Apple, LG,
-- or Logitech. Generic products have no verified manufacturer; keep brand NULL.
-- Fill missing metadata only, preserving existing classifications and drafts.
WITH verified (sku, expected_name, category, brand) AS (
	VALUES
		('DEMO-ASUS-VIVOBOOK-14', 'Laptop ASUS Vivobook 14', 'laptop', 'asus'),
		('DEMO-HEADPHONES-WIRELESS', 'Tai nghe không dây', 'audio', NULL),
		('DEMO-IPHONE-15-128', 'iPhone 15 128GB', 'phone', 'apple'),
		('DEMO-KEYBOARD-RGB', 'Bàn phím cơ RGB', 'accessories', NULL),
		('DEMO-LAPTOP-SLIM-14', 'Laptop mỏng nhẹ 14 inch', 'laptop', NULL),
		('DEMO-LG-27-2K', 'Màn hình LG 27 inch 2K', 'monitor', 'lg'),
		('DEMO-LOGITECH-G304', 'Chuột gaming Logitech G304', 'gaming', 'logitech'),
		('DEMO-PC-GAMING', 'PC gaming cấu hình mạnh', 'desktop', NULL)
)
UPDATE "products" AS p
SET "category" = COALESCE(p."category", verified.category),
	"brand" = COALESCE(p."brand", verified.brand),
	"version" = p."version" + 1,
	"updated_at" = CURRENT_TIMESTAMP
FROM verified
WHERE p."sku" = verified.sku
	AND p."name" = verified.expected_name
	AND p."active"
	AND (
		p."category" IS NULL
		OR (p."brand" IS NULL AND verified.brand IS NOT NULL)
	);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_active_category_check" CHECK (not "products"."active" or "products"."category" is not null);
