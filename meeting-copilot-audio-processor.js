class MeetingCopilotAudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) {
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    const floatSamples = Array.from(channelData);
    this.port.postMessage({
      type: 'audio-frame',
      samples: floatSamples
    });

    return true;
  }
}

registerProcessor('meeting-copilot-audio-processor', MeetingCopilotAudioProcessor);
