/* ============================================================================
   ตั้งค่าฐานข้อมูลกลาง (Supabase) — ให้ทุกเครื่องใช้ข้อมูลชุดเดียวกัน
   ----------------------------------------------------------------------------
   หาค่าได้ที่:  Supabase  ->  โปรเจกต์ของคุณ  ->  Project Settings  ->  API
     • SUPABASE_URL       = "Project URL"
     • SUPABASE_ANON_KEY  = "Project API keys" -> anon / public
   ⚠ ห้ามใส่คีย์ service_role ที่นี่เด็ดขาด (มันเป็นความลับ) — ใช้เฉพาะ anon เท่านั้น

   ถ้าเว้นว่างไว้ แอปจะทำงานแบบเดิม (เก็บข้อมูลใน localStorage ของเครื่องนั้น ๆ)
   ============================================================================ */
window.SUPABASE_URL = "https://pgimcwdxoeofokivzyyd.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnaW1jd2R4b2VvZm9raXZ6eXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MjQ0NDEsImV4cCI6MjEwNDAwMDQ0MX0.IIixXazANUKgu5xpr4xf433oJOwtW4G-iPnolvGtXx0";
