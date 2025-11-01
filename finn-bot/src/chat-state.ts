export class ChatState {
  state: DurableObjectState;
  storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async getHistory() {
    return (await this.storage.get<unknown[]>("messages")) ?? [];
  }

  async appendMessage(msg: unknown) {
    const history = await this.getHistory();
    history.push(msg);
    await this.storage.put("messages", history);
  }

  async reset() {
    await this.storage.delete("messages");
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/reset") {
      await this.reset();
      return new Response("History cleared", { status: 200 });
    }
    return new Response("OK");
  }
}
