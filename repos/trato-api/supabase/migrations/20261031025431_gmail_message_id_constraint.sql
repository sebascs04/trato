-- PostgreSQL regex repetition counts cannot exceed 255; validate length separately.
begin;
alter table public.gmail_inbound_messages
 drop constraint gmail_inbound_messages_provider_message_id_check;
alter table public.gmail_inbound_messages
 add constraint gmail_inbound_messages_provider_message_id_check
 check (char_length(provider_message_id) between 1 and 256
        and provider_message_id ~ '^[A-Za-z0-9_-]+$');
commit;
