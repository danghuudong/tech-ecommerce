ALTER TABLE products DROP CONSTRAINT products_category_check;
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (
  category IN ('laptop', 'phone', 'desktop', 'monitor', 'audio', 'accessories', 'gaming', 'office', 'tablet', 'watch', 'television', 'appliance')
);
