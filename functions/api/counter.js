export const onRequest = async ({ env }) => {
    const task = await env.KEYSTORE.get("counter");
    console.log(task);

    const newTask = ((parseInt(task) || 0) + 1).toString();
    await env.KEYSTORE.put("counter", newTask);
    return new Response(newTask);
}