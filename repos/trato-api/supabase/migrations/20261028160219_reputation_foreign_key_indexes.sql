begin;
create index reputation_links_owner on private.reputation_client_links(owner_id);
create index reputation_clients_creator on private.reputation_clients(created_by);
commit;
