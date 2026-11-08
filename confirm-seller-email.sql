-- Confirm email for seller account jedbusinos@gmail.com
-- This fixes the "Waiting for verification" issue

UPDATE auth.users 
SET email_confirmed_at = now() 
WHERE email = 'jedbusinos@gmail.com';

-- Verify the update
SELECT email, email_confirmed_at, created_at 
FROM auth.users 
WHERE email = 'jedbusinos@gmail.com';
