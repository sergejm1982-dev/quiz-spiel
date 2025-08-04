/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Der API-Schlüssel wird von der Umgebung als process.env.API_KEY bereitgestellt.
// Fehlerbehandlung für den Fall, dass der Schlüssel fehlt.
if (!process.env.API_KEY) {
  const container = document.getElementById("root");
  if (container) {
    container.innerHTML = `
      <div style="font-family: sans-serif; padding: 2rem; text-align: center; color: #333;">
        <h1>Fehler: API-Schlüssel fehlt</h1>
        <p>Der Google Gemini API-Schlüssel wurde nicht gefunden.</p>
        <p>Bitte stellen Sie sicher, dass die Umgebungsvariable <code>API_KEY</code> korrekt konfiguriert ist.</p>
      </div>
    `;
  }
  // Stoppt die weitere Ausführung des Skripts.
  throw new Error("API_KEY environment variable not set.");
}

// Initialisieren Sie den Google AI-Client mit dem API-Schlüssel.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App = () => {
  const [riddle, setRiddle] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [userGuess, setUserGuess] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riddleHistory, setRiddleHistory] = useState<string[]>([]);

  const fetchRiddle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setFeedback(null);
    setUserGuess("");
    setRiddle(null);
    
    try {
      let prompt = "Gib mir ein zufälliges, kurzes, klassisches deutsches Rätsel. Gib mir NUR das Rätsel und die Antwort im JSON-Format. Das JSON-Objekt muss ein 'raetsel' Feld (das Rätsel selbst) und ein 'antwort' Feld (die Lösung des Rätsels) haben.";
      
      if (riddleHistory.length > 0) {
        const historyString = riddleHistory.map(r => `"${r}"`).join(", ");
        prompt += `\n\nWICHTIG: Das neue Rätsel darf keines der folgenden sein, die bereits gestellt wurden: [${historyString}]. Gib mir ein komplett anderes.`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              raetsel: {
                type: Type.STRING,
                description: "Der Text des Rätsels."
              },
              antwort: {
                type: Type.STRING,
                description: "Die Lösung des Rätsels."
              }
            },
            required: ["raetsel", "antwort"]
          },
          temperature: 1,
        },
      });

      const jsonResponse = JSON.parse(response.text);
      if (jsonResponse.raetsel && jsonResponse.antwort) {
        setRiddle(jsonResponse.raetsel);
        setAnswer(jsonResponse.antwort);
        // Neues Rätsel zur Historie hinzufügen und nur die letzten 10 behalten
        setRiddleHistory(prev => [...prev.slice(-9), jsonResponse.raetsel]);
      } else {
        throw new Error("Ungültiges JSON-Format von der API erhalten.");
      }
    } catch (e) {
      console.error(e);
      setError("Entschuldigung, ein Fehler ist aufgetreten. Bitte lade die Seite neu oder versuche es später erneut.");
    } finally {
      setIsLoading(false);
    }
  }, [riddleHistory]);

  useEffect(() => {
    // Ruft beim ersten Laden der Komponente ein Rätsel ab.
    // Die eslint-disable-Regel ist hier notwendig, da fetchRiddle von riddleHistory
    // abhängt, das es selbst aktualisiert, was zu einer Endlosschleife führen würde.
    // Dieser Effekt soll nur EINMAL beim ersten Rendern ausgeführt werden.
    fetchRiddle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGuessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userGuess.trim() || !answer) return;

    setIsVerifying(true);
    setFeedback(null);

    try {
      const verificationPrompt = `
        Du bist ein Schiedsrichter für ein Rätselspiel. Deine Aufgabe ist es zu beurteilen, ob die Antwort des Benutzers auf ein gegebenes Rätsel korrekt ist. Die Antwort muss nicht exakt mit der erwarteten Lösung übereinstimmen, aber sie muss semantisch korrekt sein. Zum Beispiel, wenn die erwartete Antwort 'Eine Landkarte' ist, sind 'Landkarte' oder 'Karte' auch korrekte Antworten.

        Rätsel: "${riddle}"
        Erwartete Antwort: "${answer}"
        Antwort des Benutzers: "${userGuess}"

        Ist die Antwort des Benutzers korrekt? Antworte NUR mit einem JSON-Objekt, das einen einzigen booleschen Schlüssel 'is_correct' hat.
      `;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: verificationPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              is_correct: {
                type: Type.BOOLEAN,
                description: "True, wenn die Antwort des Benutzers korrekt ist, ansonsten false."
              }
            },
            required: ["is_correct"]
          }
        }
      });

      const result = JSON.parse(response.text);
      
      if (result.is_correct) {
        setFeedback({ message: "Richtig! Gut gemacht!", type: 'success' });
      } else {
        setFeedback({ message: `Leider falsch. Die richtige Antwort war: "${answer}"`, type: 'error' });
      }

    } catch (e) {
      console.error("Fehler bei der Überprüfung der Antwort:", e);
      setFeedback({ message: 'Entschuldigung, die Antwort konnte nicht überprüft werden. Versuche es erneut.', type: 'error' });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="container">
      <h1>Rätsel Spiel</h1>
      
      {isLoading && <div className="loader">Lade neues Rätsel...</div>}
      
      {error && <div className="error-message">{error}</div>}

      {!isLoading && !error && riddle && (
        <>
          <div className="riddle-box" aria-live="polite">
            <p>{riddle}</p>
          </div>
          
          <form onSubmit={handleGuessSubmit}>
            <div className="form-group">
              <input
                type="text"
                value={userGuess}
                onChange={(e) => setUserGuess(e.target.value)}
                placeholder="Deine Antwort..."
                aria-label="Riddle answer input"
                disabled={!!feedback || isVerifying}
              />
              <button type="submit" className="primary" disabled={!userGuess.trim() || !!feedback || isVerifying}>
                {isVerifying ? 'Prüfe...' : 'Raten'}
              </button>
            </div>
          </form>

          {feedback && (
            <div className={`feedback ${feedback.type}`} role="alert">
              {feedback.message}
            </div>
          )}

          <div className="button-container">
            <button onClick={fetchRiddle} className="secondary" disabled={isLoading}>
              Neues Rätsel
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
