#!/bin/sh
# Makes the tiny HLS stream in this folder, for bluesky-video.spec.ts.
#
#   sh tests/e2e/fixtures/hls/audible/make.sh     (from apps/caribou; needs Docker)
#
# Two seconds of a 440 Hz tone and a plain blue 32x18 picture at 5 fps.
# H.264 baseline with AAC audio, cut into two one-second MPEG-TS segments.
# The segments end in `.m2ts`, not `.ts`, so TypeScript and ESLint skip them.
# The shape is Bluesky's: `playlist.m3u8` is a main playlist that names one
# variant, `video.m3u8`, which lists the segments. ffmpeg runs from a pinned
# image, so the same command gives the same files on any machine.
set -eu
cd "$(dirname "$0")"
IMAGE='jrottenberg/ffmpeg@sha256:8ec1ee1f6a0fcd37c97725827b6b7832795c9596e3439b8da56d7700d61ae778' # 7.1-alpine
rm -f video.m3u8 seg*.m2ts
docker run --rm --platform linux/amd64 -v "$PWD:/out" "$IMAGE" -v error \
  -f lavfi -i 'color=c=blue:s=32x18:r=5:d=2' \
  -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=2' \
  -c:a aac -b:a 32k -ac 1 -shortest \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -bf 0 \
  -x264-params 'keyint=5:min-keyint=5:scenecut=0' \
  -fflags +bitexact -flags:v +bitexact \
  -f hls -hls_time 1 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename /out/seg%d.m2ts /out/video.m3u8
cat > playlist.m3u8 <<'M3U8'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=60000,RESOLUTION=32x18,CODECS="avc1.42c00a,mp4a.40.2"
video.m3u8
M3U8
