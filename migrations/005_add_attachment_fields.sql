-- Migration 005: Add IsProfilePicture, TimelineId, and IsS3 to FamilyMemberAttachment
ALTER TABLE FamilyMemberAttachment ADD COLUMN IsProfilePicture INTEGER NOT NULL DEFAULT 0;
ALTER TABLE FamilyMemberAttachment ADD COLUMN TimelineId INTEGER;
ALTER TABLE FamilyMemberAttachment ADD COLUMN IsS3 INTEGER NOT NULL DEFAULT 0;
