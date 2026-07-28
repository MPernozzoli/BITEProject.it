import { createMessageActionHandler } from "@pynkstudio/mailapp/node";
import { mailContext } from "../../src/server/mail.js";

export default createMessageActionHandler(mailContext);
