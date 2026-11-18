CREATE DATABASE IF NOT EXISTS utilityhub_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON utilityhub_test.* TO 'utilityhub'@'%';
FLUSH PRIVILEGES;
