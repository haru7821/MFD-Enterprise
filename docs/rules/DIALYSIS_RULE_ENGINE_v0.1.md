# Dialysis Rule Engine Specification


Version:

0.1


# Purpose


Validate dialysis room design based on engineering requirements.


---

# Design Principle


Rules must not be hard coded.


Incorrect:


if distance < value


Correct:


Load rule database

↓

Validate

↓

Generate result



---

# Rule Categories


## 1. Equipment Clearance


Example:


Dialysis Machine


Check:


Front Service Space

Rear Maintenance Space

Side Access



Result:


GREEN

OK


YELLOW

Review Required


RED

Not Acceptable



---

# 2. Equipment Collision


Check:


Machine overlap

Wall collision

Access blocking



---

# 3. Connection Validation


Check:


Power available

RO connection possible

Drain connection possible



---

# 4. Maintenance Access


Check:


Engineer access path


---

# Rule Data Structure


Example:


{
"id":

"AK98_FRONT_CLEARANCE",


"type":

"clearance",


"equipment":

"vantive_ak98",


"value":

1200,


"unit":

"mm",


"source":

"Manufacturer Manual"

}



---

# Future Rules


- RO Pipe Routing

- Electrical Load

- Emergency Access

- HVAC

- Fire Safety
