FROM denoland/deno:alpine-1.11.0

# Set the working directory to /testenv
WORKDIR /testenv

# Prefer not to run as root.
USER deno

# TODO: Here we would normally cache dependencies, see guide at https://hub.docker.com/r/denoland/deno

# Start a shell
CMD sh
