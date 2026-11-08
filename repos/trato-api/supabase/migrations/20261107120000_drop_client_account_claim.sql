begin;
-- "Save to my account" was replaced by matching the verified email (20261107110000). The claim table was always empty.
drop function public.client_portal_claim(text, uuid), public.client_portal_saved(text, uuid),
 private.client_portal_claim(text, uuid), private.client_portal_saved(text, uuid);
drop table public.client_account_links;
commit;
