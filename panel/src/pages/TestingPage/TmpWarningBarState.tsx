import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import useWarningBar from "@/hooks/useWarningBar";
import { connectionStateAtom } from "@/hooks/connection";
import { useAtom } from "jotai";

export default function TmpWarningBarState() {
    const [connectionState, setConnectionState] = useAtom(connectionStateAtom);
    const {
        txUpdateData, setTxUpdateData,
        fxUpdateData, setFxUpdateData,
    } = useWarningBar();

    return (
        <Card className="w-min">
            <CardHeader>
                <CardTitle>Warning Bar States</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setConnectionState('online')}>
                            Online
                        </Button>
                        <Button size="sm" onClick={() => setConnectionState('restarting')}>
                            Restarting
                        </Button>
                        <Button size="sm" onClick={() => setConnectionState('reconnecting')}>
                            Reconnecting
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(connectionState, null, 2)}
                    </pre>
                </div>

                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setTxUpdateData({
                            version: '7.0.1',
                            isImportant: false,
                        })}>
                            txa Minor Update
                        </Button>
                        <Button size="sm" onClick={() => setTxUpdateData({
                            version: '8.0.0',
                            isImportant: true,
                        })}>
                            txa Major Update
                        </Button>
                        <Button size="sm" onClick={() => setTxUpdateData(undefined)}>
                            txa No Update
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(txUpdateData, null, 2)}
                    </pre>
                </div>

                <div className="space-y-2 divide-y-2 rounded border p-2">
                    <div className="flex justify-start gap-3">
                        <Button size="sm" onClick={() => setFxUpdateData({
                            version: '7.0.1',
                            isImportant: false,
                        })}>
                            fxs Minor Update
                        </Button>
                        <Button size="sm" onClick={() => setFxUpdateData({
                            version: '8.0.0',
                            isImportant: true,
                        })}>
                            fxs Major Update
                        </Button>
                        <Button size="sm" onClick={() => setFxUpdateData(undefined)}>
                            fxs No Update
                        </Button>
                    </div>
                    <pre className="bg-muted p-2">
                        {JSON.stringify(fxUpdateData, null, 2)}
                    </pre>
                </div>
            </CardContent>
        </Card>
    );
}
