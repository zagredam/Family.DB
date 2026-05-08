-- Migration 006: Create FamilyTimelineTag table for tagging multiple members to a timeline event
CREATE TABLE FamilyTimelineTag (
    TagId          INTEGER PRIMARY KEY AUTOINCREMENT,
    TimelineId     INTEGER NOT NULL,
    FamilyMemberId INTEGER NOT NULL
);
