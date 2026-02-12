/* chat.js */
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');

    let dentistConfig = null;

    async function loadConfig() {
        try {
            const res = await fetch('dentists.json');
            dentistConfig = await res.json();
        } catch (e) {
            console.error("Failed to load dentists.json", e);
        }
    }

    function getSystemPrompt() {
        const dentistRules = dentistConfig ? JSON.stringify(dentistConfig.dentists, null, 2) : "Check dentists.json";
        return {
            role: "system",
            content: `You are a professional dental reservation assistant for "SmileCare Dental Clinic". 
            Current Local Time: ${new Date().toString()}.
            
            Clinic Rules & Dentist Schedules:
            ${dentistRules}
            
            Booking Rules:
            1. ALL TIMES ARE LOCAL. When calling tools, generate ISO 8601 strings WITHOUT the 'Z' (e.g., "2026-02-13T10:00:00").
            2. Reservation Duration: Exactly 1 hour.
            3. DO NOT DOUBLE BOOK: One doctor = one patient at a time.
            4. AVAILABILITY: Multiple appointments at the same hour are ONLY okay if they are for DIFFERENT doctors.
            5. ONLY book a doctor for their specialized service on their available days (see schedule above).
            6. ALWAYS call 'get_calendar_events' first. If you get a "CONFLICT" error from the tool, it means that doctor is definitely busy. Apologize and offer an alternative.
            7. STRICT PRIVACY: NEVER share patient names. Just say "Dr. [Name] is occupied".
            8. REQUIRED INFO: Name, Procedure, and Phone Number.
            
            Conversation Flow:
            1. Collect Name, Procedure, Phone.
            2. Check availability for the requested doctor/time.
            3. Confirm details clearly before final booking.`
        };
    }

    const messages = [];

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        if (!dentistConfig) await loadConfig();

        // Initialize or Update system prompt as the first message
        const sysPrompt = getSystemPrompt();
        if (messages.length === 0) {
            messages.push(sysPrompt);
        } else {
            messages[0] = sysPrompt;
        }

        // Add user message to UI
        appendMessage('user', text);
        chatInput.value = '';

        // Add to history
        messages.push({ role: 'user', content: text });

        // Show typing indicator (simple)
        const typingMsg = appendMessage('assistant', '...');

        try {
            const response = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages })
            });

            const data = await response.json();

            if (data.choices && data.choices[0]) {
                const message = data.choices[0].message;

                if (message.tool_calls) {
                    for (const toolCall of message.tool_calls) {
                        const functionName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments);

                        let result;
                        if (functionName === 'get_calendar_events') {
                            result = await handleGetCalendar();
                        } else if (functionName === 'create_reservation') {
                            result = await handleCreateReservation(args);
                        }

                        // Add tool response to history and ask AI again
                        messages.push(message);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: functionName,
                            content: JSON.stringify(result)
                        });
                    }

                    // Recursive call to get the final AI response after tool execution
                    const secondResponse = await fetch('api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messages: messages })
                    });
                    const secondData = await secondResponse.json();
                    const finalResponse = secondData.choices[0].message.content;

                    typingMsg.remove();
                    appendMessage('assistant', finalResponse);
                    messages.push({ role: 'assistant', content: finalResponse });
                } else {
                    typingMsg.remove();
                    const aiResponse = message.content;
                    appendMessage('assistant', aiResponse);
                    messages.push({ role: 'assistant', content: aiResponse });
                }
            } else {
                typingMsg.remove();
                appendMessage('assistant', "I'm sorry, I'm having trouble connecting to my brain.");
            }
        } catch (error) {
            console.error('Error:', error);
            typingMsg.remove();
            appendMessage('assistant', "Oops! Something went wrong.");
        }
    }

    async function handleGetCalendar() {
        const config = await fetchConfig();
        if (!config.CALENDAR_PROXY_URL) return { error: "Calendar not configured" };

        try {
            const res = await fetch(config.CALENDAR_PROXY_URL);
            const events = await res.json();
            return events;
        } catch (e) {
            return { error: "Failed to fetch calendar" };
        }
    }

    async function handleCreateReservation(args) {
        const config = await fetchConfig();
        if (!config.CALENDAR_PROXY_URL) return { error: "Calendar not configured" };

        const events = await handleGetCalendar();
        const doctorMatch = args.title.match(/Dr\.\s+(\w+)/i);
        const requestedDoctor = doctorMatch ? doctorMatch[0] : null;

        if (requestedDoctor && Array.isArray(events)) {
            const newStart = new Date(args.startTime).getTime();
            const newEnd = new Date(args.endTime).getTime();

            const conflict = events.some(ev => {
                const evStart = new Date(ev.start).getTime();
                const evEnd = new Date(ev.end).getTime();
                const isOverlapping = (newStart < evEnd) && (newEnd > evStart);
                const isSameDoctor = ev.title.includes(requestedDoctor);
                return isOverlapping && isSameDoctor;
            });

            if (conflict) {
                return {
                    error: "CONFLICT",
                    message: `Dr. ${requestedDoctor} is busy at that time. Please suggest another slot.`
                };
            }
        }

        const res = await fetch(config.CALENDAR_PROXY_URL, {
            method: 'POST',
            body: JSON.stringify(args)
        });
        return await res.json();
    }

    async function fetchConfig() {
        // Simple way to get PHP constants in JS for this local setup
        // Ideally we'd have a separate endpoint, but let's parse config.php or just hardcode for simplicity
        // For now, let's assume we can fetch it via a small helper
        const res = await fetch('get_proxy_url.php');
        return await res.json();
    }

    function appendMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        msgDiv.textContent = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv;
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});
