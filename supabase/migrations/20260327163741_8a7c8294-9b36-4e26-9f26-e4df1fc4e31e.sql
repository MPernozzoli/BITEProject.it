
-- Delete old admin accounts from auth.users (cascades to profiles, user_roles, etc.)
DELETE FROM auth.users WHERE email IN ('mpernozzoli@icloud.com', 'alexx.bear@hotmail.com', 'sami.amancio@hotmail.com');
