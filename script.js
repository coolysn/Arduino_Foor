
//  SEADED: saab kõiki aegu ja reegleid muuta
const CONFIG = {
  modes: {
    morning: { name: "Hommik", greenA: 40, greenB: 15, pedAuto: false },
    evening: { name: "Õhtu",   greenA: 30, greenB: 25, pedAuto: true  },
    night:   { name: "Öö" },
  },

  // Automaatse režiimi kellaajad (täistunnid). Ülejäänud aeg = öö.
  hours: { morning: [6, 10], evening: [10, 23] },
  yellow: 3,             // kollane (s)
  redYellow: 2,          // punane + kollane (s)
  allRed: 2,             // kõik punased faaside vahel (s)
  pedGreen: 7,           // jalakäija roheline (s)
  pedBlink: 4,           // jalakäija vilkuv roheline (s)
  minGreenOnRequest: 12, // õhtul: nupp lühendab autode rohelist, aga mitte alla selle (s)
  heartbeatMs: 2000,     // kui tihti olekut Arduinole korratakse

  peds: {
    J1: { group: "A", label: "Üle Vesivärava (lääne pool)" },
    J2: { group: "B", label: "Üle Gonsiori" },
    J3: { group: "A", label: "Üle Vesivärava (ida pool)" },
  },
};
 
// Faasid ringis. A ja B ei ole kunagi korraga rohelised.
const PHASES = [
  { id: "A_GREEN",     name: "A roheline",          A: "G",  B: "R",  dur: m => m.greenA, group: "A" },
  { id: "A_YELLOW",    name: "A kollane",           A: "Y",  B: "R",  dur: () => CONFIG.yellow },
  { id: "ALL_RED_1",   name: "Kõik punased",        A: "R",  B: "R",  dur: () => CONFIG.allRed },
  { id: "B_REDYELLOW", name: "B punane + kollane",  A: "R",  B: "RY", dur: () => CONFIG.redYellow },
  { id: "B_GREEN",     name: "B roheline",          A: "R",  B: "G",  dur: m => m.greenB, group: "B" },
  { id: "B_YELLOW",    name: "B kollane",           A: "R",  B: "Y",  dur: () => CONFIG.yellow },
  { id: "ALL_RED_2",   name: "Kõik punased",        A: "R",  B: "R",  dur: () => CONFIG.allRed },
  { id: "A_REDYELLOW", name: "A punane + kollane",  A: "RY", B: "R",  dur: () => CONFIG.redYellow },
];

const RESTART_phase = 6; //pärast ööreziimi alustame "kõik punased" faasists