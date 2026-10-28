CREATE TABLE "commerce_receiving_banks" (
	"bin" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"short_name" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "commerce_receiving_banks_bin_check" CHECK ("commerce_receiving_banks"."bin" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
-- Bank routing directory snapshot 2026-10-17: https://api.vietqr.io/v2/banks
-- E-wallet, telecom-money and finance-company entries are excluded.
INSERT INTO "commerce_receiving_banks" ("bin", "code", "short_name", "name") VALUES
('168999', 'CUBHCM', 'CUBHCM', 'Ngân hàng Cathay United Bank – Chi nhánh Hồ Chí Minh'),
('422589', 'CIMB', 'CIMB', 'Ngân hàng TNHH MTV CIMB Việt Nam'),
('458761', 'HSBC', 'HSBC', 'Ngân hàng TNHH MTV HSBC (Việt Nam)'),
('533948', 'CITIBANK', 'Citibank', 'Ngân hàng Citibank, N.A. - Chi nhánh Hà Nội'),
('546034', 'CAKE', 'CAKE', 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank'),
('546035', 'Ubank', 'Ubank', 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank'),
('555666', 'BIDC', 'BIDC', 'Ngân hàng Đầu Tư Và Phát Triển Campuchia - Chi nhánh Hà Nội'),
('668888', 'KBank', 'KBank', 'Ngân hàng Đại chúng TNHH Kasikornbank'),
('796500', 'DBS', 'DBSBank', 'DBS Bank Ltd - Chi nhánh Thành phố Hồ Chí Minh'),
('801011', 'NHB HN', 'Nonghyup', 'Ngân hàng Nonghyup - Chi nhánh Hà Nội'),
('963326', 'TNEX', 'TNEX', 'TNEX by MSB'),
('963388', 'TIMO', 'Timo', 'Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)'),
('963666', 'BNP HCM', 'BNP HCM', 'Ngân hàng BNP Paribas – Chi nhánh Thành phố Hồ Chí Minh'),
('963668', 'BNP HN', 'BNP HN', 'Ngân hàng BNP Paribas – Chi nhánh Hà Nội'),
('963669', 'ICBC', 'ICBC', 'Ngân hàng Công thương Trung Quốc – Chi nhánh thành phố Hà Nội'),
('963686', 'ESUN', 'ESUN', 'Ngân hàng Thương mại TNHH E.SUN – Chi nhánh Đồng Nai (ESUNBANK)'),
('963688', 'BOCHK', 'BOCHK', 'Ngân hàng Bank of China (Hong Kong) Limited – Chi nhánh Hồ Chí Minh'),
('970400', 'SGICB', 'SaigonBank', 'Ngân hàng TMCP Sài Gòn Công Thương'),
('970403', 'STB', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Tài Lộc'),
('970405', 'VBA', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'),
('970406', 'Vikki', 'Vikki', 'Ngân hàng TNHH Một thành viên số Vikki'),
('970407', 'TCB', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam'),
('970408', 'GPB', 'GPBank', 'Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu'),
('970409', 'BAB', 'BacABank', 'Ngân hàng TMCP Bắc Á'),
('970410', 'SCVN', 'StandardChartered', 'Ngân hàng TNHH MTV Standard Chartered Bank Việt Nam'),
('970412', 'PVCB', 'PVcomBank', 'Ngân hàng TMCP Đại Chúng Việt Nam'),
('970414', 'MBV', 'MBV', 'Ngân hàng TNHH MTV Việt Nam Hiện Đại'),
('970415', 'ICB', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam'),
('970416', 'ACB', 'ACB', 'Ngân hàng TMCP Á Châu'),
('970418', 'BIDV', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'),
('970419', 'NCB', 'NCB', 'Ngân hàng TMCP Quốc Dân'),
('970421', 'VRB', 'VRB', 'Ngân hàng Liên doanh Việt - Nga'),
('970422', 'MB', 'MBBank', 'Ngân hàng TMCP Quân đội'),
('970423', 'TPB', 'TPBank', 'Ngân hàng TMCP Tiên Phong'),
('970424', 'SHBVN', 'ShinhanBank', 'Ngân hàng TNHH MTV Shinhan Việt Nam'),
('970425', 'ABB', 'ABBANK', 'Ngân hàng TMCP An Bình'),
('970426', 'MSB', 'MSB', 'Ngân hàng TMCP Hàng Hải'),
('970427', 'VAB', 'VietABank', 'Ngân hàng TMCP Việt Á'),
('970428', 'NAB', 'NamABank', 'Ngân hàng TMCP Nam Á'),
('970429', 'SCB', 'SCB', 'Ngân hàng TMCP Sài Gòn'),
('970430', 'PGB', 'PGBank', 'Ngân hàng TMCP Thịnh vượng và Phát triển'),
('970431', 'EIB', 'Eximbank', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam'),
('970432', 'VPB', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng'),
('970433', 'VIETBANK', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín'),
('970434', 'IVB', 'IndovinaBank', 'Ngân hàng TNHH Indovina'),
('970436', 'VCB', 'Vietcombank', 'Ngân hàng TMCP Ngoại Thương Việt Nam'),
('970437', 'HDB', 'HDBank', 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh'),
('970438', 'BVB', 'BaoVietBank', 'Ngân hàng TMCP Bảo Việt'),
('970439', 'PBVN', 'PublicBank', 'Ngân hàng TNHH MTV Public Việt Nam'),
('970440', 'SEAB', 'SeABank', 'Ngân hàng TMCP Đông Nam Á'),
('970441', 'VIB', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam'),
('970442', 'HLBVN', 'HongLeong', 'Ngân hàng TNHH MTV Hong Leong Việt Nam'),
('970443', 'SHB', 'SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội'),
('970444', 'CBB', 'CBBank', 'Ngân hàng Thương mại trách nhiệm hữu hạn một thành viên Ngoại thương Công nghệ số (Vietcombank Neo Limited)'),
('970446', 'COOPBANK', 'COOPBANK', 'Ngân hàng Hợp tác xã Việt Nam'),
('970448', 'OCB', 'OCB', 'Ngân hàng TMCP Phương Đông'),
('970449', 'LPB', 'LPBank', 'Ngân hàng TMCP Lộc Phát Việt Nam'),
('970452', 'KLB', 'KienLongBank', 'Ngân hàng TMCP Kiên Long'),
('970454', 'VCCB', 'VietCapitalBank', 'Ngân hàng TMCP Bản Việt'),
('970455', 'IBK - HN', 'IBKHN', 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh Hà Nội'),
('970456', 'IBK - HCM', 'IBKHCM', 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh TP. Hồ Chí Minh'),
('970457', 'WVN', 'Woori', 'Ngân hàng TNHH MTV Woori Việt Nam'),
('970458', 'UOB', 'UnitedOverseas', 'Ngân hàng United Overseas - Chi nhánh TP. Hồ Chí Minh'),
('970462', 'KBHN', 'KookminHN', 'Ngân hàng Kookmin - Chi nhánh Hà Nội'),
('970463', 'KBHCM', 'KookminHCM', 'Ngân hàng Kookmin - Chi nhánh Thành phố Hồ Chí Minh'),
('970465', 'BSP', 'BSP', 'Ngân hàng SinoPac - Chi nhánh Thành phố Hồ Chí Minh'),
('970466', 'KEBHANAHCM', 'KEBHanaHCM', 'Ngân hàng KEB Hana – Chi nhánh Thành phố Hồ Chí Minh'),
('970467', 'KEBHANAHN', 'KEBHANAHN', 'Ngân hàng KEB Hana – Chi nhánh Hà Nội'),
('971133', 'PVDB', 'PVcomBank Pay', 'Ngân hàng số PVcomBank'),
('999888', 'VBSP', 'VBSP', 'Ngân hàng Chính sách Xã hội');
--> statement-breakpoint
ALTER TABLE "commerce_receiving_accounts" ADD COLUMN "bank_bin" text;--> statement-breakpoint
-- Resolve recognized legacy aliases without changing account IDs or receipt history.
DO $$
BEGIN
  IF EXISTS (
    SELECT a.id FROM commerce_receiving_accounts a
    JOIN commerce_receiving_banks b ON regexp_replace(lower(a.provider_code), '[^a-z0-9]', '', 'g') IN (
      b.bin,
      regexp_replace(lower(b.code), '[^a-z0-9]', '', 'g'),
      regexp_replace(lower(b.short_name), '[^a-z0-9]', '', 'g')
    )
    WHERE a.channel = 'bank_transfer'
    GROUP BY a.id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous legacy bank alias; verify the receiving account bank before migration';
  END IF;
END $$;
--> statement-breakpoint
UPDATE commerce_receiving_accounts a SET bank_bin = b.bin
FROM commerce_receiving_banks b
WHERE a.channel = 'bank_transfer' AND regexp_replace(lower(a.provider_code), '[^a-z0-9]', '', 'g') IN (
      b.bin,
      regexp_replace(lower(b.code), '[^a-z0-9]', '', 'g'),
      regexp_replace(lower(b.short_name), '[^a-z0-9]', '', 'g')
    );
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce_receiving_accounts WHERE channel = 'bank_transfer' AND bank_bin IS NULL) THEN
    RAISE EXCEPTION 'Unknown legacy bank code; map it to a verified BIN before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM commerce_receiving_accounts WHERE channel = 'bank_transfer'
    GROUP BY bank_bin, account_reference HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Receiving account aliases resolve to the same bank/account; reconcile these accounts and receipts before migration';
  END IF;
END $$;
--> statement-breakpoint
UPDATE commerce_receiving_accounts SET provider_code = bank_bin WHERE channel = 'bank_transfer';
--> statement-breakpoint
ALTER TABLE "commerce_receiving_accounts" ADD CONSTRAINT "commerce_receiving_accounts_bank_bin_commerce_receiving_banks_bin_fk" FOREIGN KEY ("bank_bin") REFERENCES "public"."commerce_receiving_banks"("bin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_receiving_accounts" ADD CONSTRAINT "commerce_receiving_accounts_bank_check" CHECK (("commerce_receiving_accounts"."channel" = 'cash' and "commerce_receiving_accounts"."bank_bin" is null) or ("commerce_receiving_accounts"."channel" = 'bank_transfer' and "commerce_receiving_accounts"."bank_bin" is not null and "commerce_receiving_accounts"."provider_code" = "commerce_receiving_accounts"."bank_bin"));
