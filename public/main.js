const WS_URL = `wss://api.aiscribe.quipohealth.com/ws`;

const form = document.getElementById("room-name-form");
const roomNameInput = document.getElementById("room-name-input");
const container = document.getElementById("video-container");
let socket;
let room;
const activeParticipants = new Map();
let isWebSocketReady = false;
let prevText = "";
let combinedMediaStream;  // To hold combined local and remote streams
let localMediaStream;     // To hold the local microphone stream
let mediaRecorder;

const startRoom = async (event) => {
    event.preventDefault();
    form.style.visibility = "hidden";

    try {
        const roomName = roomNameInput.value;

        // Fetch Access Token
        const response = await fetch("/join-room", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ roomName: roomName }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch token: ${response.statusText}`);
        }

        const { token } = await response.json();

        // Join video room
        room = await joinVideoRoom(roomName, token);
        console.log(`Joined room: ${room.name}`);

        // Capture local microphone stream
        await captureLocalMicrophone();

        // Handle participants
        handleConnectedParticipant(room.localParticipant);
        room.participants.forEach(handleConnectedParticipant);
        room.on("participantConnected", handleConnectedParticipant);

        // Handle disconnections
        room.on("participantDisconnected", handleDisconnectedParticipant);

        // Set up WebSocket
        socket = new WebSocket(WS_URL);
        socket.onopen = () => {
            console.log("WebSocket connected");
            isWebSocketReady = true;
            startRecording();  // Start streaming after WebSocket is ready
        };
        socket.onmessage = (event) => {
            console.log("Received WebSocket message:", event.data);
            handleWebSocketMessage(event);
        };
        socket.onerror = (error) => console.error("WebSocket error:", error);
        socket.onclose = () => {
            console.log("WebSocket closed");
            isWebSocketReady = false;
        };
    } catch (error) {
        console.error("Error starting room:", error);
    }
};

// Capture local microphone stream
const captureLocalMicrophone = async () => {
    try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Local microphone captured");
        if (!combinedMediaStream) {
            combinedMediaStream = new MediaStream();
        }
        localMediaStream.getAudioTracks().forEach(track => combinedMediaStream.addTrack(track));
    } catch (error) {
        console.error("Error capturing local microphone:", error);
    }
};

const handleConnectedParticipant = (participant) => {
    try {
        console.log(`Participant connected: ${participant.identity}`);
        const participantDiv = document.createElement("div");
        participantDiv.setAttribute("id", participant.identity);
        container.appendChild(participantDiv);

        participant.tracks.forEach((trackPublication) => {
            handleTrackPublication(trackPublication, participant);
        });

        participant.on("trackPublished", (trackPublication) =>
            handleTrackPublication(trackPublication, participant)
        );

        participant.on("trackSubscribed", (track) => {
            if (track.kind === 'audio') {
                console.log(`Starting real-time audio stream for ${participant.identity}`);
                addRemoteAudioToStream(track);
            }
        });

        participant.on("trackUnsubscribed", (track) => {
            if (track.kind === 'audio') {
                console.log(`Stopping real-time audio stream for ${participant.identity}`);
                removeRemoteAudioFromStream(track);
            }
        });
    } catch (error) {
        console.error("Error handling connected participant:", error);
    }
};

const handleTrackPublication = (trackPublication, participant) => {
    try {
        if (trackPublication.track) {
            displayTrack(trackPublication.track, participant);
        }
        trackPublication.on("subscribed", (track) => displayTrack(track, participant));
    } catch (error) {
        console.error("Error handling track publication:", error);
    }
};

const displayTrack = (track, participant) => {
    try {
        const participantDiv = document.getElementById(participant.identity);
        participantDiv.append(track.attach());
        if (track.kind === 'audio') {
            console.log(`Audio track attached for ${participant.identity}`);
        }
    } catch (error) {
        console.error("Error displaying track:", error);
    }
};

// Add remote audio track to the combined media stream
const addRemoteAudioToStream = (audioTrack) => {
    try {
        if (!combinedMediaStream) {
            combinedMediaStream = new MediaStream();
        }
        combinedMediaStream.addTrack(audioTrack.mediaStreamTrack);
        console.log("Remote audio added to combined stream");

        // Restart the recording with the updated combined stream
        restartRecording();
    } catch (error) {
        console.error("Error adding remote audio track:", error);
    }
};

// Remove remote audio track from the combined media stream
const removeRemoteAudioFromStream = (audioTrack) => {
    try {
        combinedMediaStream.removeTrack(audioTrack.mediaStreamTrack);
        console.log("Remote audio removed from combined stream");

        // Restart the recording with the updated combined stream
        restartRecording();
    } catch (error) {
        console.error("Error removing remote audio track:", error);
    }
};

// Stop the existing mediaRecorder and start a new one with the updated combined stream
const restartRecording = () => {
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();  // Stop the existing recording
            console.log("Stopped existing media recorder");
        }

        startRecording();  // Start a new recording with the updated stream
    } catch (error) {
        console.error("Error restarting the recording:", error);
    }
};

// Start recording the combined stream and sending it to the WebSocket
const startRecording = () => {
    try {
        if (!combinedMediaStream) {
            console.error("No combined stream available to record");
            return;
        }

        const options = { mimeType: "audio/webm" };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            throw new Error(`Unsupported MIME type: ${options.mimeType}`);
        }

        mediaRecorder = new MediaRecorder(combinedMediaStream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && isWebSocketReady) {
                socket.send(event.data);
                console.log("Real-time audio data sent to WebSocket");
            }
        };

        mediaRecorder.onerror = (error) => {
            console.error("MediaRecorder error:", error);
        };

        mediaRecorder.start(1000);  // Stream audio every second
        console.log("Recording combined stream and sending to WebSocket");
    } catch (error) {
        console.error("Error starting recording:", error);
    }
};


const handleWebSocketMessage = (event) => {
    try {
        const data = event.data;
        displayTranscription(data);
    } catch (error) {
        console.error("Error parsing WebSocket message:", error);
    }
};

const displayTranscription = (transcription) => {
    try {
        prevText = prevText + transcription;
        const participantDiv = document.getElementById("transcription-text");
        participantDiv.innerText = prevText;
    } catch (error) {
        console.error("Error displaying transcription:", error);
    }
};

const handleDisconnectedParticipant = (participant) => {
    try {
        console.log(`Participant disconnected: ${participant.identity}`);
        const participantDiv = document.getElementById(participant.identity);
        participantDiv.remove();

        const mediaRecorder = activeParticipants.get(participant.identity);
        if (mediaRecorder) {
            mediaRecorder.stop();
            activeParticipants.delete(participant.identity);
        }
    } catch (error) {
        console.error("Error handling disconnected participant:", error);
    }
};

const joinVideoRoom = async (roomName, token) => {
    try {
        console.log(`Attempting to join room: ${roomName}`);
        return await Twilio.Video.connect(token, { room: roomName });
    } catch (error) {
        console.error("Error joining video room:", error);
        throw error;
    }
};

form.addEventListener("submit", startRoom);
