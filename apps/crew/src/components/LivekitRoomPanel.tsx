import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  VideoConference,
} from "@livekit/components-react";
import { Track } from "livekit-client";

type LivekitRoomPanelProps = {
  serverUrl: string;
  token: string;
  video: boolean;
  canPublish: boolean;
};

const ViewerStage = () => {
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  );

  return (
    <>
      <RoomAudioRenderer />
      <div className="min-h-[24rem] bg-slate-950">
        <GridLayout tracks={tracks} className="min-h-[24rem]">
          <ParticipantTile />
        </GridLayout>
      </div>
    </>
  );
};

const LivekitRoomPanel = ({ serverUrl, token, video, canPublish }: LivekitRoomPanelProps) => (
  <LiveKitRoom
    serverUrl={serverUrl}
    token={token}
    connect
    video={canPublish && video}
    audio={canPublish}
    className="min-h-[24rem]"
  >
    {canPublish ? <VideoConference /> : <ViewerStage />}
  </LiveKitRoom>
);

export default LivekitRoomPanel;
