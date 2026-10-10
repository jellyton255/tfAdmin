import React from "react";
import { PlayerModalHasError } from "./PlayerModalHasError";
import { captureMenuError } from "../../../utils/sentry";

interface PlayerErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class PlayerModalErrorBoundary extends React.Component<
  any,
  PlayerErrorBoundaryState
> {
  public state = {
    hasError: false,
    errorMessage: "Unknown Error Occurred",
  };

  public constructor(props) {
    super(props);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    captureMenuError(error, "playerModal");
  }

  render() {
    if (this.state.hasError) {
      return <PlayerModalHasError msg={this.state.errorMessage} />;
    }

    return this.props.children;
  }
}
