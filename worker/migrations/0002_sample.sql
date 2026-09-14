-- SAMPLE town settings, SLA defaults, the SAMPLE PIN 3690 (PBKDF2-SHA256, 100 000 iterations; made with tools/hash-pin.mjs)
-- and the three SAMPLE crews. POST /api/test/reset writes the same rows from src/sample.js; tests/unit.test.mjs checks they match.

INSERT INTO settings (id, town_name, emergency_phone, office_phone, office_hours, sla_days, pin_hash, pin_salt, pin_iterations)
VALUES (1, 'SAMPLE Town of Harbour Pond (demo)', '709-555-0142', '709-555-0100', 'Monday to Friday, 9 AM to 4:30 PM',
  '{"pothole":14,"streetlight":10,"snow":2,"water":3,"garbage":3,"tree":5,"other":14}',
  'eDgQfmxhAIq9BJaxiUZgzQiqjJIRc9bYEeKjqg7uv3g=', 'OseAgYK1dia5PkE4jNZUig==', 100000);

INSERT INTO crews (id, name, active) VALUES
  (1, 'Roads crew (SAMPLE)', 1),
  (2, 'Water and sewer crew (SAMPLE)', 1),
  (3, 'Parks and trees crew (SAMPLE)', 1);
