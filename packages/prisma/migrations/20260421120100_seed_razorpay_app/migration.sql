INSERT INTO "App" ("slug", "dirName", "categories", "keys", "createdAt", "updatedAt", "enabled")
VALUES ('razorpay', 'razorpay', ARRAY['payment']::"AppCategories"[], '{}'::jsonb, NOW(), NOW(), true)
ON CONFLICT ("slug") DO NOTHING;
