-- Run once as a DBA after 001_schema.sql. Grant this role to the API's login role.
-- Verification/login services use separate, narrowly scoped DB credentials.
CREATE ROLE pudi_api NOLOGIN;
GRANT USAGE ON SCHEMA public TO pudi_api;
GRANT SELECT ON app_users,auth_sessions,livestock_listings TO pudi_api;
GRANT SELECT,INSERT ON conversations,chat_messages TO pudi_api;
-- Row locking conversations requires UPDATE permission on at least one column.
GRANT UPDATE(created_at) ON conversations TO pudi_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON chat_outbox TO pudi_api;
GRANT USAGE ON SEQUENCE chat_messages_id_seq TO pudi_api;
-- No UPDATE on app_users or livestock_listings: the API cannot self-verify sellers.
