require("dotenv").config();
const {Configuration, OpenAIApi} = require("openai");

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function chat(messages) {
    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages,
        });
        let data = {
            id: completion.data.id,
            created: completion.data.created,
            usage: completion.data.usage,
            message: completion.data.choices[0].message
        }
        // console.log(completion);
        // console.log(data);
        return data;
    } catch (error) {
        // let {message, type, param, code} = error.response.data;
        // if (code.equal("context_length_exceeded"))
        // console.error(error.response.data);
        return error.response.data;
    }
}

// const messages = [
//     {"role": "system", "content": "You are a helpful assistant."},
//     {"role": "user", "content": "Who won the world series in 2020?"},
//     {"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
//     {"role": "user", "content": "Where was it played?"}
// ];
// chat(messages).then(res => console.log(res));

module.exports = {chat};
