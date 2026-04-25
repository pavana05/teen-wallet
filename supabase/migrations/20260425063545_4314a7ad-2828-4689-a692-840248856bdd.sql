UPDATE auth.users
SET email_confirmed_at = now()
WHERE email LIKE '%@teenwallet.local'
  AND email_confirmed_at IS NULL;