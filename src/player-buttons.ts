import { SignalWatcher } from "@lit-labs/signals";
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import {
    createElement,
    PlayCircle,
    PauseCircle,
    StepBack,
    StepForward,
    SkipBack,
    SkipForward
} from "lucide";
import { PlayerState, PLAYERSTATE_SIG } from "./signals";

@customElement("player-buttons")
export class PlayerButtons extends SignalWatcher(LitElement) {
    private handlePlayClick() {
        switch (PLAYERSTATE_SIG.get()) {
            case PlayerState.PLAYING:
                PLAYERSTATE_SIG.set(PlayerState.PAUSED);
                break;
            case PlayerState.PAUSED:
                PLAYERSTATE_SIG.set(PlayerState.PLAYING);
                break;
        }
    }

    // Render
    render() {
        return html`
            <div class="icon-container">${createElement(SkipBack)}</div>
            <div class="icon-container">${createElement(StepBack)}</div>
            <div class="icon-container" @click=${this.handlePlayClick}>
                ${PLAYERSTATE_SIG.get() === PlayerState.PAUSED
                    ? createElement(PauseCircle)
                    : createElement(PlayCircle)}
            </div>
            <div class="icon-container">${createElement(StepForward)}</div>
            <div class="icon-container">${createElement(SkipForward)}</div>
        `;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            height: auto;
            width: 100%;
            gap: 2em;
            cursor: pointer;
        }
        .icon-container {
            font-size: 2em;
        }
        .icon-container svg {
            width: 1.5em;
            height: 1.5em;
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        "player-buttons": PlayerButtons;
    }
}
