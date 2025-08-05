/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

const categoryMap: { [key: string]: string } = {
  lustig: 'lustiges',
  mathematisch: 'mathematisches(bei falsch soll die Antwort begründet sein)',
  detektiv: 'Detektiv (man kann aus zwei oder drei Alternativen auswählen. Die Antwort soll zeigen warum es richtig oder falsch ist)',
  mysteriös: 'seltsam verrücktes (aber mit Hinweisen, man kann es fast herauslesen was die Antwort ist)',
  minecraft: 'über Minecraft',
};
const categoryLabels: { [key: string]: string } = {
  lustig: 'Lustig',
  mathematisch: 'Mathematisch',
  detektiv: 'Detektiv',
  mysteriös: 'Mysteriös und seltsam',
  minecraft: 'Minecraft',
};

const App = () => {
  const [riddle, setRiddle] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [userGuess, setUserGuess] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riddleHistory, setRiddleHistory] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('lustig');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Use a stable reference for the AI client
  const [aiClient] = useState(() => new GoogleGenAI({ apiKey: process.env.API_KEY }));

  const fetchRiddle = useCallback(async () => {
    // Stop any speech before fetching a new riddle
    if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
    }
      
    setIsLoading(true);
    setError(null);
    setFeedback(null);
    setUserGuess("");
    setRiddle(null);
    
    try {
      const categoryDescription = categoryMap[selectedCategory];
      let prompt = `Gib mir ein zufälliges, kurzes, ${categoryDescription}  Rätsel. Gib mir NUR das Rätsel und die Antwort im JSON-Format. Das JSON-Objekt muss ein 'raetsel' Feld (das Rätsel selbst) und ein 'antwort' Feld (die Lösung des Rätsels) haben.`;
      
      if (riddleHistory.length > 0) {
        const historyString = riddleHistory.map(r => `"${r}"`).join(", ");
        prompt += `\n\nWICHTIG: Das neue Rätsel darf keines der folgenden sein, die bereits gestellt wurden: [${historyString}]. Gib mir ein komplett anderes.`;
      }

      const response = await aiClient.models.generateContent({
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
        // Add new riddle to history, keeping only the last 10 to prevent the prompt from getting too long
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
  }, [aiClient, riddleHistory, selectedCategory]);

  useEffect(() => {
    fetchRiddle();
    
    // Cleanup function to stop speech synthesis when the component unmounts
    return () => {
        if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }
    };
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
      
      const response = await aiClient.models.generateContent({
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

  const handleSpeak = () => {
    if (!riddle || typeof window.speechSynthesis === 'undefined') {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(riddle);
    utterance.lang = 'de-DE';
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = (event) => {
      console.error("Fehler bei der Sprachausgabe:", event);
      setIsSpeaking(false);
    };
    
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="container">
      <h1>Rätsel Spiel</h1>

      <div className="category-selector" role="radiogroup" aria-labelledby="category-label">
        <span id="category-label" className="sr-only">Rätselkategorie auswählen</span>
        {Object.keys(categoryLabels).map((key) => (
          <React.Fragment key={key}>
            <input
              type="radio"
              id={key}
              name="category"
              value={key}
              checked={selectedCategory === key}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={isLoading}
            />
            <label htmlFor={key}>{categoryLabels[key]}</label>
          </React.Fragment>
        ))}
      </div>
      
      {isLoading && <div className="loader">Lade neues Rätsel...</div>}
      
      {error && <div className="error-message">{error}</div>}

      {!isLoading && !error && riddle && (
        <>
          <div className="riddle-box" aria-live="polite">
            <p>{riddle}</p>
            {typeof window.speechSynthesis !== 'undefined' && (
               <button 
                onClick={handleSpeak} 
                className="speak-button" 
                disabled={isSpeaking}
                aria-label={isSpeaking ? "Vorlesen stoppen" : "Rätsel vorlesen"}
                title={isSpeaking ? "Vorlesen stoppen" : "Rätsel vorlesen"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" >
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              </button>
            )}
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
            <button onClick={() => fetchRiddle()} className="secondary" disabled={isLoading}>
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
