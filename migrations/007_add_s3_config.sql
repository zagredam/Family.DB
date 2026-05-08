-- Migration 007: Create S3Config table for S3-compatible storage settings (single record)
CREATE TABLE S3Config (
    S3ConfigId  INTEGER PRIMARY KEY DEFAULT 1,
    Endpoint    TEXT NOT NULL,
    BucketName  TEXT NOT NULL,
    AccessKey   TEXT NOT NULL,
    SecretKey   TEXT NOT NULL,
    Region      TEXT NOT NULL DEFAULT 'us-east-1'
);
