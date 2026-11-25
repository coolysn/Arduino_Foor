/*
  Gonsiori – Vesivärava ristmiku foorid (Arduino osa)

  Arduino on "täitja": kogu loogika (faasid, režiimid, jalakäijate nupud)
  on veebilehel. Veebileht saadab USB (Serial, 9600 baud) kaudu käske,
  Arduino süütab füüsiliste fooride tuled ja saadab kinnituse.

  Sõnumid veebilt (üks JSON rida, lõpus \n):
    {"A":"G","B":"R"}     -> foorigruppide olek (R, Y, G, RY, OFF)
    {"mode":"night"}      -> öörežiim, Arduino vilgutab ise kollast

  Sõnumid Arduinolt:
    {"ready":1,"v":"2026-11-23"} -> Arduino käivitus + koodi versioon
    {"ack":"A:G,B:R"}           -> uus olek võeti kasutusele
    {"ack":"mode:night"}        -> öörežiim sisse lülitatud
    {"warn":"timeout"}          -> side katkes, ohutuse mõttes kollane vilkur
    {"err":"..."}               -> vigane / ohtlik käsk, ei täidetud

  Ühendused (fooriLED-moodulid, takistid on moodulil juba olemas):
    Moodul A (grupp A, näitab A1 ja A2):  pin 9 = R,  pin 8 = Y,  pin 7 = G
    Moodul B (grupp B):                   pin 10 = R, pin 11 = Y, pin 12 = G
    Mõlema mooduli GND -> leivalaua sinine (−) rada -> Arduino GND.
    Pinnid 2, 3, 4 = A2 jaoks varuks (füüsilist moodulit pole, võib jätta tühjaks).
    Pinnid 5 ja 6 hoitakse kustus (vana kodutöö jalakäija foor).
*/

const char* VERSIOON = "2026-11-23";      // muuda, kui koodi muudad – näed veebi logist, mis kood plaadil on

const int A_R  = 9,  A_Y  = 8,  A_G  = 7;   // moodul A (grupp A)
const int A2_R = 2,  A2_Y = 3,  A2_G = 4;   // A2 varuks, näitab alati sama mis A (moodulit pole)
const int B_R  = 10, B_Y  = 11, B_G  = 12;  // moodul B (grupp B)

const unsigned long TIMEOUT_MS = 5000;  // kui nii kaua sõnumeid ei tule -> kollane vilkur
const unsigned long BLINK_MS = 1000;    // kollase vilkuri pool-periood

String aState = "OFF";
String bState = "OFF";
bool nightMode = true;                  // kuni veebileht pole ühendunud, vilgub kollane
unsigned long lastMsg = 0;
String inputBuf = "";

// Lülitab ühe foori tuled vastavalt olekule
void setLight(int r, int y, int g, const String &s) {
  digitalWrite(r, (s == "R" || s == "RY") ? HIGH : LOW);
  digitalWrite(y, (s == "Y" || s == "RY") ? HIGH : LOW);
  digitalWrite(g, (s == "G") ? HIGH : LOW);
}

void applyStates() {
  setLight(A_R, A_Y, A_G, aState);
  setLight(A2_R, A2_Y, A2_G, aState);
  setLight(B_R, B_Y, B_G, bState);
}

// Võtab lihtsast JSON-ist väärtuse: {"A":"G"} -> getValue(msg, "A") == "G"
String getValue(const String &msg, const String &key) {
  String pattern = "\"" + key + "\":\"";
  int start = msg.indexOf(pattern);
  if (start < 0) return "";
  start += pattern.length();
  int end = msg.indexOf('"', start);
  if (end < 0) return "";
  return msg.substring(start, end);
}

bool validState(const String &s) {
  return s == "R" || s == "Y" || s == "G" || s == "RY" || s == "OFF";
}

void handleMessage(const String &msg) {
  lastMsg = millis();

  String mode = getValue(msg, "mode");
  if (mode == "night") {
    if (!nightMode) Serial.println("{\"ack\":\"mode:night\"}");
    nightMode = true;
    return;
  }

  String a = getValue(msg, "A");
  String b = getValue(msg, "B");
  if (a.length() == 0 || b.length() == 0) return;  // tundmatu sõnum

  if (!validState(a) || !validState(b)) {
    Serial.println("{\"err\":\"tundmatu olek\"}");
    return;
  }
  // Ohutuskontroll: A ja B ei tohi kunagi korraga rohelised olla
  if (a == "G" && b == "G") {
    Serial.println("{\"err\":\"A ja B ei tohi korraga rohelised olla\"}");
    return;
  }

  bool changed = nightMode || a != aState || b != bState;
  nightMode = false;
  aState = a;
  bState = b;
  applyStates();
  if (changed) {
    Serial.print("{\"ack\":\"A:");
    Serial.print(aState);
    Serial.print(",B:");
    Serial.print(bState);
    Serial.println("\"}");
  }
}

void setup() {
  int pins[] = {A_R, A_Y, A_G, A2_R, A2_Y, A2_G, B_R, B_Y, B_G};
  for (int i = 0; i < 9; i++) pinMode(pins[i], OUTPUT);
  // Vana kodutöö jalakäija foor (pinnid 5 ja 6) – hoiame kindlalt kustus
  pinMode(5, OUTPUT); digitalWrite(5, LOW);
  pinMode(6, OUTPUT); digitalWrite(6, LOW);
  Serial.begin(9600);
  Serial.print("{\"ready\":1,\"v\":\"");
  Serial.print(VERSIOON);
  Serial.println("\"}");
}

void loop() {
  // Loeme sissetulevad märgid reahaaval
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      inputBuf.trim();
      if (inputBuf.length() > 0) handleMessage(inputBuf);
      inputBuf = "";
    } else if (inputBuf.length() < 100) {
      inputBuf += c;
    }
  }

  // Ohutus: kui veebileht vaikib, läheme kollasele vilkurile
  if (!nightMode && millis() - lastMsg > TIMEOUT_MS) {
    nightMode = true;
    Serial.println("{\"warn\":\"timeout\"}");
  }

  if (nightMode) {
    bool on = (millis() / BLINK_MS) % 2 == 0;
    setLight(A_R, A_Y, A_G, on ? "Y" : "OFF");
    setLight(A2_R, A2_Y, A2_G, on ? "Y" : "OFF");
    setLight(B_R, B_Y, B_G, on ? "Y" : "OFF");
  }
}
