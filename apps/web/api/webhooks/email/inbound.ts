import { createInboundWebhookHandler } from "@pynkstudio/mailapp/node";
import { mailContext } from "../../../src/server/mail.js";

export default createInboundWebhookHandler(mailContext);
