-- Fix duplicate posting-group rows when legacy AFTER INSERT triggers were left
-- active next to trg_event_after_sync_* (wrong DROP TRIGGER names in 202604).
--
-- itemPostingGroup: 20260410031811 dropped "create_posting_groups_for_item_posting_group"
-- but the real trigger from 20230820020844_posting-groups.sql is "create_item_posting_group".
--
-- location: 20260410031811 dropped "create_related_records_for_location" but the trigger
-- has always been named "create_location" (function was renamed to
-- create_related_records_for_location in 20250616131548_production-planning.sql).
--
-- customerType / supplierType: 20260410031807_type-group-posting-interceptors.sql used the
-- correct trigger names (create_customer_type_group, create_posting_groups_for_customer_type,
-- create_supplier_type_group, create_posting_groups_for_supplier_type) — no extra drops.

DROP TRIGGER IF EXISTS create_item_posting_group ON "itemPostingGroup";
DROP TRIGGER IF EXISTS create_posting_groups_for_item_posting_group ON "itemPostingGroup";

DROP TRIGGER IF EXISTS create_location ON "location";
DROP TRIGGER IF EXISTS create_related_records_for_location ON "location";
