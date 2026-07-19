import { LiveKitRoom, VideoConference } from "@livekit/components-react";

type LivekitRoomPanelProps = {
  serverUrl: string;
  token: string;
  video: boolean;
};

const LivekitRoomPanel = ({ serverUrl, token, video }: LivekitRoomPanelProps) => (
  <LiveKitRoom
    serverUrl={serverUrl}
    token={token}
    connect
    video={video}
    audio
    className="min-h-[24rem]"
  >
    <VideoConference />
  </LiveKitRoom>
);

export default LivekitRoomPanel;
