CREATE OR REPLACE FUNCTION public.get_linked_children()
RETURNS TABLE(link_id uuid, teen_user_id uuid, teen_name text, teen_balance numeric, link_status text, linked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    fl.id AS link_id,
    fl.teen_user_id,
    p.full_name AS teen_name,
    p.balance AS teen_balance,
    fl.status AS link_status,
    fl.created_at AS linked_at
  FROM public.family_links fl
  JOIN public.profiles p ON p.id = fl.teen_user_id
  WHERE fl.parent_user_id = auth.uid()
    AND fl.status = 'active';
END;
$$;
