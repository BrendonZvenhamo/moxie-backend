-- Initial Schema for Moxie

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum for Platform
CREATE TYPE platform_type AS ENUM ('whatsapp', 'telegram');

-- Enum for User Status
CREATE TYPE user_status_type AS ENUM ('idle', 'searching', 'matched');

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT NOT NULL, -- WhatsApp number or Telegram ID
    platform platform_type NOT NULL,
    username TEXT,
    bio TEXT,
    gender TEXT,
    purpose TEXT,
    onboarding_step TEXT DEFAULT 'start',
    interests TEXT[] DEFAULT '{}',
    normalized_interests TEXT[] DEFAULT '{}',
    status user_status_type DEFAULT 'idle',
    current_match_id UUID,
    is_banned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(external_id, platform)
);

-- Reports Table
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES users(id),
    reported_id UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Matches Table
CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_1_id UUID NOT NULL REFERENCES users(id),
    user_2_id UUID NOT NULL REFERENCES users(id),
    shared_interests TEXT[] DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    CHECK (user_1_id < user_2_id) -- Prevent duplicate match entries for same pair
);

-- Blocked Users (Relationship)
CREATE TABLE blocked_users (
    blocker_id UUID REFERENCES users(id),
    blocked_id UUID REFERENCES users(id),
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id)
);

-- Contacts (Accepted Friends)
CREATE TABLE contacts (
    user_id UUID REFERENCES users(id),
    contact_id UUID REFERENCES users(id),
    status TEXT DEFAULT 'pending', -- 'pending', 'accepted'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, contact_id)
);

-- Indexes for performance
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_platform ON users(platform);
CREATE INDEX idx_users_onboarding_step ON users(onboarding_step);
CREATE INDEX idx_users_purpose ON users(purpose);
CREATE INDEX idx_users_interests ON users USING GIN (interests);
CREATE INDEX idx_users_normalized_interests ON users USING GIN (normalized_interests);
CREATE INDEX idx_users_banned ON users(is_banned);
CREATE INDEX idx_matches_active ON matches(ended_at) WHERE ended_at IS NULL;
