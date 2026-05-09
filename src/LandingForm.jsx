import { useState, useEffect, useRef } from "react";
import { doc, getDoc, updateDoc, addDoc, collection, query, where, getDocs, increment } from "firebase/firestore";
import { db } from "./firebase";

// ══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════════════════════
const MAX_PIN_USES = 10;
const TEST_PIN = "TEST@1234!";
const getMaxPinUses = (pin) => pin === TEST_PIN ? 1000 : MAX_PIN_USES;

// ══════════════════════════════════════════════════════════════════════════════
//  FIELD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
function Field({ label, id, type = "text", value, onChange, error, placeholder, icon, maxLength }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <label htmlFor={id} style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: focused ? "#059669" : "#6b7280",
        marginBottom: 7, transition: "color 0.2s",
        fontFamily: "'DM Mono', monospace",
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span> {label}
      </label>
      <input
        id={id} type={type} value={value} maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        style={{
          width: "100%", padding: "11px 14px",
          background: focused ? "#f0fdf4" : "#f9fafb",
          border: `1.5px solid ${error ? "#ef4444" : focused ? "#059669" : "#e5e7eb"}`,
          borderRadius: 10, color: "#111827", fontSize: 14.5,
          fontFamily: "'DM Sans', sans-serif", outline: "none",
          transition: "all 0.2s", boxSizing: "border-box",
          boxShadow: focused ? "0 0 0 3px rgba(5,150,105,0.1)" : "0 1px 2px rgba(0,0,0,0.04)",
        }}
      />
      {error && (
        <p style={{ color: "#ef4444", fontSize: 11, marginTop: 5, fontFamily: "'DM Mono', monospace", display: "flex", alignItems: "center", gap: 4 }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  LANDING FORM
// ══════════════════════════════════════════════════════════════════════════════
export default function LandingForm({ onAccessGranted }) {
  const [form, setForm] = useState({ fullName: "", studentId: "", university: "", faculty: "", courseName: "", courseCode: "", pin: "" });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle");
  const [serverError, setServerError] = useState("");
  const [locationData, setLocationData] = useState({ ip: "unknown", country: "", city: "", latitude: "", longitude: "" });
  const [submitted, setSubmitted] = useState(false);
  const sessionKeyRef = useRef(null);

  const [trialType] = useState(() => {
    const stored = sessionStorage.getItem("bioreactor_trialType");
    sessionStorage.removeItem("bioreactor_trialType");
    return stored || "new_session";
  });

  useEffect(() => {
    fetch("https://ipapi.co/json/")
      .then(r => r.json())
      .then(d => {
        if (d && d.ip) {
          setLocationData({
            ip: d.ip || "unknown",
            country: d.country_name || d.country || "",
            city: d.city || "",
            latitude: String(d.latitude || ""),
            longitude: String(d.longitude || ""),
          });
        } else { throw new Error("Invalid response"); }
      })
      .catch(() => {
        fetch("https://ipwho.is/")
          .then(r => r.json())
          .then(d => setLocationData({
            ip: d.ip || "unknown",
            country: d.country || "",
            city: d.city || "",
            latitude: String(d.latitude || ""),
            longitude: String(d.longitude || ""),
          }))
          .catch(() => {
            fetch("https://api.ipify.org?format=json")
              .then(r => r.json())
              .then(d => setLocationData(prev => ({ ...prev, ip: d.ip })))
              .catch(() => { });
          });
      });
  }, []);

  useEffect(() => {
    if (!submitted) return;
    const startTime = Date.now();
    const log = () => {
      if (!sessionKeyRef.current) return;
      const endTime = Date.now();
      const durationMin = ((endTime - startTime) / 60000).toFixed(2);
      updateDoc(doc(db, "sessions", sessionKeyRef.current), {
        "Exit Time": new Date().toISOString(),
        "Current Session Duration (min)": durationMin,
        "overallExitTime": new Date().toISOString(),
      }).catch(() => { });
    };
    window.addEventListener("beforeunload", log);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") log(); });
    return () => window.removeEventListener("beforeunload", log);
  }, [submitted]);

  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: "" })); };

  const validate = () => {
    const e = {};
    if (!form.fullName.trim()) e.fullName = "Full name is required";
    if (!form.studentId.trim()) e.studentId = "Student ID is required";
    if (!form.university.trim()) e.university = "University is required";
    if (!form.faculty.trim()) e.faculty = "Faculty is required";
    if (!form.courseName.trim()) e.courseName = "Course name is required";
    if (!form.courseCode.trim()) e.courseCode = "Course code is required";
    if (!form.pin.trim()) e.pin = "PIN code is required";
    return e;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    if (status === "loading" || status === "success") return;
    setStatus("loading"); setServerError("");

    const enteredPin = form.pin.trim();
    try {
      const pinDocRef = doc(db, "validPins", enteredPin);
      const pinDoc = await getDoc(pinDocRef);

      if (!pinDoc.exists()) {
        setErrors({ pin: "Invalid PIN \u2014 check with your instructor" });
        setStatus("idle");
        return;
      }

      const pinData = pinDoc.data();
      const currentUsage = pinData.usageCount || 0;

      if (currentUsage \u003e= getMaxPinUses(enteredPin)) {
        setErrors({ pin: "You have reached your maximum number of attempts. Please contact your instructor." });
        setStatus("idle");
        return;
      }

      const newUsageCount = currentUsage + 1;
      const attemptTimestamp = new Date().toISOString();

      await updateDoc(pinDocRef, {
        usageCount: increment(1),
        lastUsedBy: form.studentId.trim(),
        lastUsedAt: attemptTimestamp,
        status: newUsageCount \u003e= getMaxPinUses(enteredPin) ? "exhausted" : "active",
      });

      addDoc(collection(db, "pinAttempts"), {
        pin_code: enteredPin,
        student_id: form.studentId.trim(),
        attempt_number: newUsageCount,
        trial_type: trialType,
        attempt_type: "new_session",
        timestamp: attemptTimestamp,
        location: { ...locationData },
      }).catch((err) => console.error("Failed to log attempt:", err));

    } catch (err) {
      console.error("PIN validation error:", err);
      setServerError("Unable to validate PIN. Please try again.");
      setStatus("idle");
      return;
    }

    const entryTime = new Date().toISOString();
    const studentId = form.studentId.trim();

    let existingDocId = null;
    const pinSessionRef = doc(db, "sessions", `pin_${enteredPin}`);
    try {
      const pinSessionDoc = await getDoc(pinSessionRef);
      if (pinSessionDoc.exists()) {
        existingDocId = `pin_${enteredPin}`;
      }
    } catch { }

    if (!existingDocId) {
      try {
        const studentQuery = query(
          collection(db, "sessions"),
          where("Student ID", "==", studentId)
        );
        const studentSnap = await getDocs(studentQuery);
        if (!studentSnap.empty) {
          existingDocId = studentSnap.docs[0].id;
        }
      } catch { }
    }

    const sessionKey = existingDocId || `pin_${enteredPin}`;
    sessionKeyRef.current = sessionKey;

    if (existingDocId) {
      updateDoc(doc(db, "sessions", existingDocId), {
        "Last Entry Time": entryTime,
        "Exit Time": "",
        "Current Session Duration (min)": "0.00",
        "IP Address": locationData.ip,
        "Location": { ...locationData },
        "Session Key": sessionKey,
        "overallExitTime": "",
        "Full Name": form.fullName.trim(),
        "University": form.university.trim(),
        "Faculty": form.faculty.trim(),
        "Course Name": form.courseName.trim(),
        "Course Code": form.courseCode.trim(),
      }).catch(() => { });
    } else {
      setDoc(doc(db, "sessions", sessionKey), {
        "Full Name": form.fullName.trim(),
        "Student ID": studentId,
        "University": form.university.trim(),
        "Faculty": form.faculty.trim(),
        "Course Name": form.courseName.trim(),
        "Course Code": form.courseCode.trim(),
        "PIN": enteredPin,
        "Last Entry Time": entryTime,
        "Exit Time": "",
        "Current Session Duration (min)": "0.00",
        "IP Address": locationData.ip,
        "Location": { ...locationData },
        "Session Key": sessionKey,
        "overallEntryTime": entryTime,
        "overallExitTime": "",
        "Latest Trial": null,
        "Trials History": []
      }).catch(() => { });
    }

    setStatus("success");
    setSubmitted(true);
    setTimeout(() => onAccessGranted({
      name: form.fullName.trim(),
      sessionKey,
      pin: enteredPin,
      studentId: form.studentId.trim(),
      locationData: { ...locationData },
      trialType,
      entryTime,
    }), 2400);
  };

  if (status === "success") return (
    <div style={pageStyle}>
      <style>{css}</style>
      <div style={successCard}>
        <div style={successIconWrap}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, color: "#064e3b", margin: "20px 0 8px", fontWeight: 700 }}>Access Granted</h2>
        <p style={{ color: "#6b7280", fontFamily: "'DM Sans', sans-serif", fontSize: 15, margin: 0 }}>
          Welcome, \u003cstrong style={{ color: "#111827" }}\u003e{form.fullName.trim()}\u003c/strong\u003e
        </p>
        <p style={{ color: "#9ca3af", fontFamily: "'DM Mono', monospace", fontSize: 11, marginTop: 10, letterSpacing: "0.06em" }}>LAUNCHING BIOREACTOR SIMULATOR\u2026</p>
        <div style={{ height: 3, background: "#d1fae5", borderRadius: 99, marginTop: 20, overflow: "hidden" }}>
          <div className="fill-bar" style={{ height: "100%", background: "linear-gradient(90deg,#10b981,#059669)", borderRadius: 99 }} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={pageStyle}>
      <style>{css}</style>
      <div style={{ position: "fixed", top: -140, right: -140, width: 440, height: 440, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.1),transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -120, left: -100, width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(5,150,105,0.07),transparent 70%)", pointerEvents: "none" }} />

      <div className="card-in" style={outerWrap}>
        <div style={accentPanel}>
          <div style={{ position: "relative", zIndex: 2 }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 27, color: "#fff", fontWeight: 700, lineHeight: 1.25, margin: "0 0 14px" }}>
              Welcome to\u003cbr /\u003eBioreactor\u003cbr /\u003eLab
            </h2>
            <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.75, margin: "0 0 28px" }}>
              A real-time microbial growth simulation environment for undergraduate students.
            </p>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.18)", paddingTop: 20 }}>
              {["Real-time growth curves", "Multi-species support", "Nutrient \u0026 pH control", "Session auto-logging"].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11, color: "rgba(255,255,255,0.82)", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, flexShrink: 0 }}>\u2713</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: -50, right: -50, width: 200, height: 200, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.09)" }} />
          <div style={{ position: "absolute", bottom: -15, right: -15, width: 110, height: 110, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)" }} />
        </div>

        <div style={formPanel}>
          <div style={{ marginBottom: 26 }}>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 99, padding: "4px 12px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#065f46", letterSpacing: "0.09em", fontFamily: "'DM Mono', monospace" }}>LAB SESSION ACCESS</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 10 }}>
              <img src={`${import.meta.env.BASE_URL}logo1.jpg`} alt="Logo 1" style={{ height: 60, width: "auto", objectFit: "contain" }} />
              <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: "clamp(20px,3vw,28px)", fontWeight: 700, color: "#111827", margin: 0, textAlign: "center", flex: 1 }}>Student Sign-In</h1>
              <div style={{ display: "flex", gap: 8 }}>
                <img src={`${import.meta.env.BASE_URL}logo2.jpg`} alt="Logo 2" style={{ height: 50, width: "auto", objectFit: "contain" }} />
                <img src={`${import.meta.env.BASE_URL}logo3.jpg`} alt="Logo 3" style={{ height: 50, width: "auto", objectFit: "contain" }} />
              </div>
            </div>
            <p style={{ color: "#9ca3af", fontSize: 13.5, fontFamily: "'DM Sans', sans-serif", margin: 0, textAlign: "center" }}>All fields are required to access the simulator.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 16px" }}>
            <Field id="fullName" label="Full Name" icon="\uD83D\uDC64" placeholder="e.g. Layla Hassan" value={form.fullName} onChange={set("fullName")} error={errors.fullName} />
            <Field id="studentId" label="Student ID" icon="\uD83E\uDEAA" placeholder="e.g. 20231234" value={form.studentId} onChange={set("studentId")} error={errors.studentId} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 16px" }}>
            <Field id="university" label="University" icon="\uD83C\uDFDB\uFE0F" placeholder="e.g. Cairo University" value={form.university} onChange={set("university")} error={errors.university} />
            <Field id="faculty" label="Faculty" icon="\uD83C\uDF93" placeholder="e.g. Faculty of Science" value={form.faculty} onChange={set("faculty")} error={errors.faculty} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 16px" }}>
            <Field id="courseName" label="Course Name" icon="\uD83D\uDCD3" placeholder="e.g. Microbial Biotechnology" value={form.courseName} onChange={set("courseName")} error={errors.courseName} />
            <Field id="courseCode" label="Course Code" icon="\uD83D\uDCA7" placeholder="e.g. BIO-401" value={form.courseCode} onChange={set("courseCode")} error={errors.courseCode} />
          </div>
          <div style={{ maxWidth: 210 }}>
            <Field id="pin" label="Access PIN" icon="\uD83D\uDD10" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" value={form.pin} onChange={set("pin")} error={errors.pin} maxLength={12} />
          </div>

          {serverError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>
              \u26A0 {serverError}
            </div>
          )}

          <button onClick={handleSubmit} disabled={status === "loading"} className="submit-btn" style={{ width: "100%", padding: "14px 24px", background: status === "loading" ? "#6ee7b7" : "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15.5, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", cursor: status === "loading" ? "not-allowed" : "pointer", letterSpacing: "0.02em", boxShadow: "0 4px 14px rgba(5,150,105,0.28)", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            {status === "loading" ? <>\u003cspan className="spinner" /\u003e Validating\u2026</> : "Enter Laboratory \u2192"}
          </button>

          <p style={{ color: "#d1d5db", fontSize: 11, textAlign: "center", marginTop: 14, fontFamily: "'DM Mono', monospace", lineHeight: 1.6 }}>
            \uD83D\uDD12 Session data logged for academic purposes \u00B7 Entry \u0026 exit times recorded
          </p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════════════════════════════════════
const pageStyle = {
  minHeight: "100vh",
  background: "linear-gradient(150deg,#f0fdf4 0%,#ffffff 45%,#f8fafc 100%)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: "24px 16px", position: "relative", overflow: "hidden",
  fontFamily: "'DM Sans', sans-serif",
};
const outerWrap = {
  display: "flex", width: "100%", maxWidth: 860,
  background: "#ffffff", borderRadius: 20,
  boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 20px 60px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.05)",
  overflow: "hidden", position: "relative", zIndex: 5, flexWrap: "wrap",
};
const accentPanel = {
  background: "linear-gradient(160deg,#065f46 0%,#047857 60%,#059669 100%)",
  padding: "40px 30px", width: "100%", maxWidth: 250, flexShrink: 0,
  position: "relative", overflow: "hidden",
};
const formPanel = { flex: 1, minWidth: 280, padding: "36px 36px 28px", background: "#fff" };
const successCard = {
  background: "#fff", borderRadius: 20, padding: "52px 48px", textAlign: "center",
  maxWidth: 400, width: "100%",
  boxShadow: "0 20px 60px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.05)",
  position: "relative", zIndex: 5,
};
const successIconWrap = {
  width: 72, height: 72, borderRadius: "50%",
  background: "#ecfdf5", border: "2px solid #6ee7b7",
  display: "flex", alignItems: "center", justifyContent: "center",
  margin: "0 auto", boxShadow: "0 0 0 8px rgba(16,185,129,0.07)",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;0,700;1,600\u0026family=DM+Sans:wght@400;500;600;700\u0026family=DM+Mono:wght@400;500;700\u0026display=swap');
  * { box-sizing: border-box; }
  input::placeholder { color: #d1d5db; }
  @keyframes cardIn {
    from { opacity:0; transform:translateY(20px) scale(0.98); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }
  .card-in { animation: cardIn 0.6s cubic-bezier(0.22,1,0.36,1) both; }
  .submit-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(5,150,105,0.38) !important;
  }
  .submit-btn:active:not(:disabled) { transform: translateY(0); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    display: inline-block; width:16px; height:16px;
    border: 2px solid rgba(255,255,255,0.35);
    border-top-color: #fff; border-radius:50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes fillBar { from{width:0%} to{width:100%} }
  .fill-bar { animation: fillBar 2.2s ease-in-out forwards; }
`;
