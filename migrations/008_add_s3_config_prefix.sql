-- Migration 008: Add optional key prefix to S3Config
ALTER TABLE S3Config ADD COLUMN Prefix TEXT;
