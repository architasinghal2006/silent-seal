export interface Recording {
  blob: Blob
  mime: string
}

export interface ActiveRecorder {
  stop: () => Promise<Recording>
}

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

/** Ask for the microphone. Only call from the survivor's own tap: this can show a prompt. */
export function requestMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

export function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

/** Like location, the microphone is only used silently once it is already allowed. */
export async function microphoneAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export function startRecording(stream: MediaStream): ActiveRecorder {
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  recorder.start()

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stopStream(stream)
          const mime = recorder.mimeType || 'audio/webm'
          resolve({ blob: new Blob(chunks, { type: mime }), mime })
        }
        recorder.stop()
      }),
  }
}
