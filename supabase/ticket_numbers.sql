-- Persisted ticket numbering: TKT-<year>-<sequence>

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS ticket_number TEXT;

CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1000;

CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR btrim(NEW.ticket_number) = '' THEN
    NEW.ticket_number := 'TKT-' || to_char(COALESCE(NEW.created_at, NOW()), 'YYYY') || '-' || lpad(nextval('ticket_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_ticket_number ON tickets;
CREATE TRIGGER tickets_set_ticket_number
BEFORE INSERT ON tickets
FOR EACH ROW EXECUTE FUNCTION set_ticket_number();

UPDATE tickets
SET ticket_number = 'TKT-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('ticket_number_seq')::text, 5, '0')
WHERE ticket_number IS NULL OR btrim(ticket_number) = '';

CREATE UNIQUE INDEX IF NOT EXISTS tickets_ticket_number_unique_idx
ON tickets(ticket_number);

ALTER TABLE tickets
ALTER COLUMN ticket_number SET NOT NULL;
