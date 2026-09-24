-- PUBLIC's EXECUTE on new functions is a global default, which a per-schema
-- ALTER DEFAULT PRIVILEGES cannot remove. Revoke it globally for postgres, so
-- every future function starts private and needs an explicit grant.
alter default privileges for role postgres revoke execute on functions from public;
