ALTER TABLE files DROP CONSTRAINT files_byte_size_check;
ALTER TABLE files ADD CONSTRAINT files_byte_size_check
    CHECK (byte_size >= 0 AND byte_size <= 104857600);
