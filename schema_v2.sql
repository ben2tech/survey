-- อัปเกรดจากเวอร์ชันก่อนหน้า โดย "ไม่ลบข้อมูลเดิม" (รันครั้งเดียว)
-- เพิ่ม: รอบการประเมิน, ด้านของคำถาม, ห้องในผลตอบ, ประกาศ PDPA
CREATE TABLE IF NOT EXISTS students (student_id TEXT PRIMARY KEY, name TEXT, class TEXT, plan_id INTEGER);
CREATE TABLE rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO rounds (name) VALUES ('ภาคเรียนที่ 2/2569');   -- ข้อมูลเดิมทั้งหมดจะอยู่ในรอบนี้ (id = 1) แก้ชื่อได้ในหน้า admin
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
ALTER TABLE questions ADD COLUMN category_id INTEGER;
CREATE TABLE responses_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  plan_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  class TEXT,
  answers TEXT NOT NULL,
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(round_id, student_id, role)
);
INSERT INTO responses_new (id,round_id,student_id,plan_id,role,class,answers,comment,created_at)
  SELECT id,1,student_id,plan_id,role,(SELECT class FROM students s WHERE s.student_id=responses.student_id),answers,comment,created_at FROM responses;
DROP TABLE responses;
ALTER TABLE responses_new RENAME TO responses;
INSERT OR IGNORE INTO settings VALUES ('current_round','1'),('consent_required','1'),
 ('consent_text','ข้อมูลที่ท่านกรอก ได้แก่ รหัสนักเรียน แผนการเรียน และคำตอบแบบสอบถาม จะถูกใช้เพื่อประเมินและปรับปรุงคุณภาพการจัดการเรียนการสอนของโรงเรียนเท่านั้น
ผู้ดูแลระบบที่โรงเรียนมอบหมายเท่านั้นที่เข้าถึงข้อมูลรายบุคคลได้ รายงานผลจะนำเสนอเป็นภาพรวม ไม่ระบุตัวบุคคล
ข้อมูลจะถูกเก็บตามระยะเวลาที่โรงเรียนกำหนด ท่านสามารถติดต่อโรงเรียนเพื่อขอใช้สิทธิตามกฎหมายคุ้มครองข้อมูลส่วนบุคคลได้');
INSERT OR IGNORE INTO settings VALUES ('require_roster','0');
