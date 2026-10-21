CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE users(id serial PRIMARY KEY,email text UNIQUE NOT NULL,name text,fcm_token text);
CREATE TABLE facilities(id serial PRIMARY KEY,name text NOT NULL,block text,location geography(Point,4326));
CREATE TABLE bookings(id serial PRIMARY KEY,facility_id int REFERENCES facilities,user_id int REFERENCES users,day date NOT NULL,
  period int NOT NULL CHECK(period BETWEEN 1 AND 7),status text NOT NULL DEFAULT 'booked');
-- Double booking is impossible: the database refuses a second 'booked' row for the same room, day and period.
CREATE UNIQUE INDEX one_booking_per_slot ON bookings(facility_id,day,period) WHERE status='booked';
CREATE TABLE watches(user_id int REFERENCES users,facility_id int REFERENCES facilities,day date,period int);
CREATE TABLE lost_found(id serial PRIMARY KEY,user_id int REFERENCES users,kind text,item text,description text,place text,day date);
