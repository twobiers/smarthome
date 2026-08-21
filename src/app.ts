import * as mqtt from "mqtt";
import { ActionHueState, ActionState, HueState, SleepAsAndroidEvent, State } from "./types";
import dotenv from "dotenv";
import { stat } from "fs";
import { logger } from "./logger";

dotenv.config();

const kitchenSwitchTopic = "zigbee2mqtt/switch_kitchen_1";
const setKitchenLampTopic = "zigbee2mqtt/lamp_kitchen_1/set";
const setBedroomLampTopic = "zigbee2mqtt/lamp_bedroom_1/set";
const setLivingRoomLampTopic = "zigbee2mqtt/lamp_living_room_1/set";
const getLivingRoomLampTopic = "zigbee2mqtt/lamp_living_room_1";
const livingRoomSwitchTopic = "zigbee2mqtt/switch_living_room_1";
const sleepAsAndroidTopic = "SleepAsAndroid";

// Smarthome bridge
const getBridgeBrightnessLivingRoomTopic = "smarthome/lamp_living_room_1/brightness";
const setBridgeBrightnessLivingRoomTopic = "smarthome/lamp_living_room_1/brightness/set";
const getBridgeColorTempLivingRoomTopic = "smarthome/lamp_living_room_1/color_temp";
const setBridgeColorTempLivingRoomTopic = "smarthome/lamp_living_room_1/color_temp/set";
const getBridgeColorHexLivingRoomTopic = "smarthome/lamp_living_room_1/color_hex";
const setBridgeColorHexLivingRoomTopic = "smarthome/lamp_living_room_1/color_hex/set";


const client = mqtt.connect(`mqtt://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`);
let timeoutId: ReturnType<typeof setTimeout> | null = null;

const turnAllTheLightsOn = () => {
    const stateOn = {
        state: "ON",
        brightness: 150,
        transition: 90
    };
    client.publish(setBedroomLampTopic, JSON.stringify(stateOn));
};

const turnAllTheLightsOff = () => {
    const stateOff = {
        state: "OFF"
    };
    client.publish(setBedroomLampTopic, JSON.stringify(stateOff));
};

const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
};

const subscribe = (topic: string) => {
    client.subscribe(topic, (err) => {
        if (!err) {
            logger.info({ topic }, "Subscribed to topic");
        } else {
            logger.error({ err, topic }, "Failed to subscribe to topic");
        }
    });
}

client.on("error", (err) => {
    logger.error({ err }, "Could not connect to MQTT broker");
});

client.on("connect", () => {
    logger.info("Connected to MQTT broker");
});

subscribe(sleepAsAndroidTopic);
subscribe(setBedroomLampTopic);
subscribe(kitchenSwitchTopic);
subscribe(livingRoomSwitchTopic);

bridgeJsonToPlaintextTopic(getLivingRoomLampTopic, getBridgeBrightnessLivingRoomTopic, "brightness");
bridgePlaintextToJsonTopic(setBridgeBrightnessLivingRoomTopic, setLivingRoomLampTopic, "brightness", { transition: 1 });
bridgeJsonToPlaintextTopic(getLivingRoomLampTopic, getBridgeColorTempLivingRoomTopic, "color_temp");
bridgePlaintextToJsonTopic(setBridgeColorTempLivingRoomTopic, setLivingRoomLampTopic, "color_temp", { transition: 1 });
bridgeJsonToPlaintextTopic(getLivingRoomLampTopic, getBridgeColorHexLivingRoomTopic, "color.hex");
bridgePlaintextToJsonTopic(setBridgeColorHexLivingRoomTopic, setLivingRoomLampTopic, "color.hex", { transition: 1 });

client.on("message", (topic, payload) => {
    logger.debug({ topic, payload: payload.toString() }, "Received message");
});

client.on("message", (topic, payload) => {
    // If we toggled the lamp manually, there is nothing left to do
    if (topic === setBedroomLampTopic) {
        resetTimeout();
    } 
    else if (topic === sleepAsAndroidTopic) {
        const event = JSON.parse(payload.toString()) as SleepAsAndroidEvent;
        if(event.event == "alarm_alert_start") {
            turnAllTheLightsOn();
        }

        if(event.event == "alarm_alert_dismiss") {
            resetTimeout();

            // Time to wake up otherwise turn the lights off
            timeoutId = setTimeout(turnAllTheLightsOff, 15 * 60 * 1000);
        }
    }
    else if (topic === kitchenSwitchTopic) {
        const action = (JSON.parse(payload.toString()) as ActionState).action;
        if (!action) {
            logger.debug({ topic }, "Received message without action, ignoring");
            return;
        }
        const state = action.toUpperCase();
        const desiredLampState = { state };
        client.publish(setKitchenLampTopic, JSON.stringify(desiredLampState));
    }
    else if (topic === livingRoomSwitchTopic) {
        const action = (JSON.parse(payload.toString()) as ActionHueState).action;
        if (!action) {
            logger.debug({ topic }, "Received message without action, ignoring");
            return;
        }
        const state = action.toUpperCase() as HueState;
        handleHueSwitch(state);
    }
    else {
        logger.debug({ topic }, "No mapping found for topic");
    }
});

function handleHueSwitch(state: HueState) {
    const stateToggles: readonly HueState[] = ["ON_PRESS", "ON_HOLD", "OFF_PRESS", "OFF_HOLD"] as const;
    const brightnessToggles: readonly HueState[] = ["UP_PRESS", "DOWN_PRESS"] as const;
    const brightnessMoveStart: readonly HueState[] = ["UP_HOLD", "DOWN_HOLD"] as const;
    const brightnessMoveStop: readonly HueState[] = ["UP_HOLD_RELEASE", "DOWN_HOLD_RELEASE"] as const;

    let desiredState = {};

    if (stateToggles.includes(state)) {
        desiredState = {
            state: "TOGGLE"
        };
    }
    else if (brightnessToggles.includes(state)) {
        const stepSize = 25;
        desiredState = {
            "brightness_step": state.startsWith("UP") ? stepSize : 0 - stepSize,
            transition: 1
        }
    } else if (brightnessMoveStart.includes(state)) {
        const stepSize = 25;
        desiredState = {
            "brightness_step": state.startsWith("UP") ? stepSize : 0 - stepSize
        }
    } else if (brightnessMoveStop.includes(state)) {
        /* desiredState = {
            "brightness_move": 0
        }*/
    }
    client.publish(setLivingRoomLampTopic, JSON.stringify(desiredState));
}

function bridgeJsonToPlaintextTopic(subTopic: string, pubTopic: string, path: string) {
    client.subscribe(subTopic);
    client.on("message", (topic, payload) => {
        if (topic !== subTopic || !payload) return;

        const jsonPayload = JSON.parse(payload.toString());
        const get = (obj: any, path: string): any => { 
            const keys = path.split('.');
            const lastKey = keys.pop()!;
            let lastObj = obj;

            for (const key of keys) {
                lastObj = lastObj[key] || {};
            }

            return lastObj[lastKey];
        };  
        // if (res.length === 0) {
        //     console.warn(`No result found. topic: '%s', path: '%s'`, subTopic, path);
        //     return;
        // }
        // if (res.length > 1) {
        //     console.warn(`Received more results than expected. Defaulting to first. topic: '%s', path: '%s', results: '%O'`, subTopic, path, res);
        // }

        const extracted = get(jsonPayload, path);
        if (!extracted) {
            logger.warn({ subTopic, path }, "No result found for path");
            return;
        }
        const extractedString = String(extracted);
        logger.debug({ subTopic, pubTopic, value: extractedString }, "Bridging JSON to plaintext topic");
        client.publish(pubTopic, extractedString);
    });
}

function bridgePlaintextToJsonTopic(subTopic: string, pubTopic: string, property: string, additionalProps?: any) {
    client.subscribe(subTopic);
    client.on("message", (topic, payload) => {
        if (topic !== subTopic || !payload) return;

        const jsonPayload = {
            ...additionalProps
        };

        const set = (obj: any, path: string, val: any) => {
            const keys = path.split('.');
            const lastKey = keys.pop()!;
            let lastObj = obj;

            for (const key of keys) {
                lastObj[key] = {};
                lastObj = lastObj[key];
            }
            lastObj[lastKey] = val;
        };  
        set(jsonPayload, property, payload.toString());

        logger.debug({ subTopic, pubTopic, payload: jsonPayload }, "Bridging plaintext to JSON topic");
        client.publish(pubTopic, JSON.stringify(jsonPayload));
    });
}