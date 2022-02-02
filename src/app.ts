import * as mqtt from "mqtt";
import { SleepAsAndroidEvent } from "./types";
import dotenv from "dotenv";

dotenv.config();

const client = mqtt.connect(`mqtt://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`);

client.on("error", (err) => {
    console.error(`Could not connect to MQTT Broker: ${err}`);
});

client.on("connect", () => {
    console.log("Successfully connected to MQTT Broker");
});

client.subscribe("SleepAsAndroid", (err) => {
    if(!err) {
        console.log("Successfully subscribed to SleepAsAndroid Topic");
    } else {
        console.error(err);
        console.error("Could not subscribe to SleepAsAndroid Topic");
    }
});

client.on("message", (topic, payload) => {
    console.log(`Recieved Message: '${topic}' with '${payload}'`);
    if(topic === "SleepAsAndroid") {
        const event = JSON.parse(payload.toString()) as SleepAsAndroidEvent;
        if(event.event == "alarm_alert_start") {
            const setState = {
                state: "ON",
                brightness: 0,
                color: {
                    x: 1,
                    y: 1
                },
            };
            const setLightTransition = {
                brightness: 255,
                transition: 90
            }
            client.publish("zigbee2mqtt/bedroom/set", JSON.stringify(setState));
            client.publish("zigbee2mqtt/bedroom/set", JSON.stringify(setLightTransition));
        }
    }
});
